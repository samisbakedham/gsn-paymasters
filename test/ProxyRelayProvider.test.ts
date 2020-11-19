import { GsnTestEnvironment } from '@opengsn/gsn/dist/GsnTestEnvironment'
import { AccountKeypair } from '@opengsn/gsn/dist/src/relayclient/AccountManager'
import { Address } from '@opengsn/gsn/dist/src/relayclient/types/Aliases'
import { expectEvent } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'
import abi from 'web3-eth-abi'

import {
  ProxyDeployingPaymasterInstance,
  ProxyFactoryInstance,
  TestCounterInstance,
  TestTokenInstance
} from '../types/truffle-contracts'
import ProxyRelayProvider, { ProxyGSNConfig } from '../src/ProxyRelayProvider'

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
        forwarderAddress
      }
    } = await GsnTestEnvironment.startGsn('localhost', false)
    const hub = await RelayHub.at(relayHubAddress)
    await paymaster.setRelayHub(hub.address)
    await paymaster.setTrustedForwarder(forwarderAddress)
    await hub.depositFor(paymaster.address, {
      value: 1e18.toString()
    })

    const gsnConfig: Partial<ProxyGSNConfig> = {
      signerAddress: accounts[0],
      relayHubAddress,
      forwarderAddress,
      paymasterAddress: paymaster.address
    }
    proxyRelayProvider = new ProxyRelayProvider(
      web3.currentProvider as HttpProvider,
      gsnConfig, {
        asyncPaymasterData: async () => {
          // @ts-expect-error
          return abi.encodeParameters(['address'], [uniswap.address])
        }
      }
    )
    await proxyRelayProvider.udpateProxyAddresses()
  })

  context('#_ethSendTransaction()', function () {
    let counter: TestCounterInstance
    let gaslessAccount: AccountKeypair
    let proxyAddress: Address
    let web3: Web3

    before(async function () {
      counter = await TestCounter.new()
      // @ts-expect-error
      web3 = TestCounter.web3

      web3.setProvider(proxyRelayProvider)
      // gaslessAccount = proxyRelayProvider.newAccount()
      gaslessAccount = { address: accounts[0], privateKey: Buffer.from('ignored') }

      proxyAddress = await paymaster.calculateAddress(gaslessAccount.address, 0)

      // const gotAccounts = await web3.eth.getAccounts()
      //
      // //make sure the calculated proxy address is reported in getAccounts()
      // assert.include(gotAccounts, proxyAddress)
      // //this is the same..
      // assert.equal(gotAccounts[gotAccounts.length-1], proxyAddress)

      await token.mint(1e18.toString())
      await token.transfer(proxyAddress, 1e18.toString())
    })

    it('should relay transparently and deploy proxy', async function () {
      const countBefore = await counter.count()
      assert.strictEqual(countBefore.toNumber(), 0)

      const from = proxyAddress
      console.log('using account: ', from)

      const tx1 = await counter.increment({
        from,
        gasPrice: 1
      })
      console.log('ret=', tx1)

      await expectEvent.inTransaction(tx1.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })

      const countAfter1 = await counter.count()
      assert.strictEqual(countAfter1.toNumber(), 1)

      const tx2 = await counter.increment({
        from,
        gasPrice: 1
      })
      const countAfter2 = await counter.count()
      assert.strictEqual(countAfter2.toNumber(), 2)
      await expectEvent.not.inTransaction(tx2.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })
      await expectEvent.inTransaction(tx2.tx, TestToken, 'Transfer')
    })
  })
})
