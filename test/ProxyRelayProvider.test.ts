import GsnTestEnvironment from '@opengsn/gsn/dist/GsnTestEnvironment'
import { AccountKeypair } from '@opengsn/gsn/src/relayclient/AccountManager'
import { Address } from '@opengsn/gsn/dist/src/relayclient/types/Aliases'
import { expectEvent } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'

import {
  ProxyDeployingPaymasterInstance,
  ProxyFactoryInstance,
  TestCounterInstance,
  TestTokenInstance
} from '../types/truffle-contracts'
import ProxyRelayProvider from '../src/ProxyRelayProvider'

const RelayHub = artifacts.require('RelayHub')
const TestToken = artifacts.require('TestToken')
const TestCounter = artifacts.require('TestCounter')
const TestUniswap = artifacts.require('TestUniswap')
const ProxyFactory = artifacts.require('ProxyFactory')
const ProxyDeployingPaymaster = artifacts.require('ProxyDeployingPaymaster')

contract('ProxyRelayProvider', function (accounts) {
  let token: TestTokenInstance
  let proxyFactory: ProxyFactoryInstance
  let paymaster: ProxyDeployingPaymasterInstance
  let proxyRelayProvider: ProxyRelayProvider

  before(async function () {
    proxyFactory = await ProxyFactory.new()
    const uniswap = await TestUniswap.new(2, 1, {
      value: (5e18).toString(),
      gas: 1e7
    })
    proxyFactory = await ProxyFactory.new()
    token = await TestToken.at(await uniswap.tokenAddress())
    paymaster = await ProxyDeployingPaymaster.new([uniswap.address], proxyFactory.address)
    const {
      deploymentResult: {
        relayHubAddress,
        stakeManagerAddress,
        forwarderAddress
      }
      // @ts-ignore
    } = await GsnTestEnvironment.startGsn('localhost', false)
    const hub = await RelayHub.at(relayHubAddress)
    await paymaster.setRelayHub(hub.address)
    await paymaster.setTrustedForwarder(forwarderAddress)
    await hub.depositFor(paymaster.address, {
      value: 1e18.toString()
    })
    const gsnConfig = {
      relayHubAddress,
      forwarderAddress,
      stakeManagerAddress,
      paymasterAddress: paymaster.address
    }
    proxyRelayProvider = new ProxyRelayProvider(
      proxyFactory.address,
      web3.currentProvider as HttpProvider,
      gsnConfig
    )
  })

  context('#_calculateProxyAddress()', function () {
    it('should calculate proxy address correctly', async function () {
      const proxyAddressOnChainCalculation = await proxyFactory.calculateAddress(accounts[0])
      const proxyAddressOffChainCalculation = proxyRelayProvider._calculateProxyAddress(accounts[0], 0)
      assert.strictEqual(proxyAddressOnChainCalculation.toLowerCase(), proxyAddressOffChainCalculation.toLowerCase())
    })
  })

  context('#_ethSendTransaction()', function () {
    let counter: TestCounterInstance
    let gaslessAccount: AccountKeypair
    let proxyAddress: Address

    before(async function () {
      counter = await TestCounter.new()
      // @ts-ignore
      TestCounter.web3.setProvider(proxyRelayProvider)
      gaslessAccount = proxyRelayProvider.newAccount()
      proxyAddress = web3.utils.toChecksumAddress(proxyRelayProvider._calculateProxyAddress(gaslessAccount.address, 0))

      await token.mint(1e18.toString())
      await token.transfer(proxyAddress, 1e18.toString())
    })

    it('should relay transparently', async function () {
      const countBefore = await counter.count()
      assert.strictEqual(countBefore.toNumber(), 0)

      const tx1 = await counter.increment({
        from: gaslessAccount.address,
        gasPrice: 1
      })

      await expectEvent.inTransaction(tx1.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })

      const countAfter1 = await counter.count()
      assert.strictEqual(countAfter1.toNumber(), 1)

      const tx2 = await counter.increment({
        from: gaslessAccount.address,
        gasPrice: 1
      })
      const countAfter2 = await counter.count()
      assert.strictEqual(countAfter2.toNumber(), 2)
      await expectEvent.not.inTransaction(tx2.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })
      await expectEvent.inTransaction(tx2.tx, TestToken, 'Transfer')
    })
  })
})
