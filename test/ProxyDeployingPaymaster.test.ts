import 'source-map-support/register'
import { RelayProvider } from '@opengsn/gsn'
import { decodeRevertReason, getEip712Signature } from '@opengsn/gsn/dist/src/common/Utils'
import { Address } from '@opengsn/gsn/dist/src/relayclient/types/Aliases'
import TypedRequestData, { GsnRequestType } from '@opengsn/gsn/dist/src/common/EIP712/TypedRequestData'
import RelayRequest, { cloneRelayRequest } from '@opengsn/gsn/dist/src/common/EIP712/RelayRequest'
import { defaultEnvironment } from '@opengsn/gsn/dist/src/common/Environments'
import { snapshot, revert, deployHub } from '@opengsn/gsn/dist/test/TestUtils'
import { GsnTestEnvironment } from '@opengsn/gsn/dist/src/relayclient/GsnTestEnvironment'

import { constants, expectEvent } from '@openzeppelin/test-helpers'
import { PrefixedHexString } from 'ethereumjs-tx'
import { HttpProvider } from 'web3-core'
import { registerAsRelayServer, revertReason } from './TestUtils'
import {
  IForwarderInstance,
  TestProxyInstance,
  TestTokenInstance,
  TestUniswapInstance,
  ProxyDeployingPaymasterInstance,
  TestHubInstance,
  TestCounterInstance,
  ProxyFactoryInstance, StakeManagerInstance
} from '../types/truffle-contracts'
import { RelayHubInstance } from '@opengsn/gsn/dist/types/truffle-contracts'
import { transferErc20Error } from './TokenPaymaster.test'

const RelayHub = artifacts.require('RelayHub')
const TestHub = artifacts.require('TestHub')
const Forwarder = artifacts.require('Forwarder')
const TestProxy = artifacts.require('TestProxy')
const TestToken = artifacts.require('TestToken')
const TestCounter = artifacts.require('TestCounter')
const TestUniswap = artifacts.require('TestUniswap')
const ProxyFactory = artifacts.require('ProxyFactory')
const ProxyIdentity = artifacts.require('ProxyIdentity')
const StakeManager = artifacts.require('StakeManager')
const ProxyDeployingPaymaster = artifacts.require('ProxyDeployingPaymaster')

contract('ProxyDeployingPaymaster', ([senderAddress, relayWorker]) => {
  const tokensPerEther = 2

  let paymaster: ProxyDeployingPaymasterInstance
  let relayHub: RelayHubInstance
  let testHub: TestHubInstance
  let proxyAddress: Address
  let token: TestTokenInstance
  let relayRequest: RelayRequest
  let recipient: TestProxyInstance
  let stakeManager: StakeManagerInstance
  let signature: PrefixedHexString
  let uniswap: TestUniswapInstance
  let forwarder: IForwarderInstance
  let proxyFactory: ProxyFactoryInstance

  async function assertDeployed (address: Address, deployed: boolean): Promise<void> {
    const code = await web3.eth.getCode(address)
    const assertion = deployed ? assert.notStrictEqual : assert.strictEqual
    assertion(code, '0x')
  }

  const gasData = {
    pctRelayFee: '0',
    baseRelayFee: '0',
    gasPrice: '1',
    gasLimit: 1e6.toString()
  }
  before(async function () {
    uniswap = await TestUniswap.new(tokensPerEther, 1, {
      value: (5e18).toString(),
      gas: 1e7
    })
    proxyFactory = await ProxyFactory.new()
    token = await TestToken.at(await uniswap.tokenAddress())
    paymaster = await ProxyDeployingPaymaster.new([uniswap.address], proxyFactory.address)
    forwarder = await Forwarder.new({ gas: 1e7 })
    recipient = await TestProxy.new(forwarder.address, { gas: 1e7 })
    stakeManager = await StakeManager.new()
    testHub = await TestHub.new(
      stakeManager.address,
      constants.ZERO_ADDRESS,
      defaultEnvironment.relayHubConfiguration.maxWorkerCount,
      defaultEnvironment.relayHubConfiguration.gasReserve,
      defaultEnvironment.relayHubConfiguration.postOverhead,
      defaultEnvironment.relayHubConfiguration.gasOverhead,
      defaultEnvironment.relayHubConfiguration.maximumRecipientDeposit,
      defaultEnvironment.relayHubConfiguration.minimumUnstakeDelay,
      defaultEnvironment.relayHubConfiguration.minimumStake,
      { gas: 10000000 })
    relayHub = await deployHub(stakeManager.address)
    await paymaster.setRelayHub(relayHub.address)
    await forwarder.registerRequestType(GsnRequestType.typeName, GsnRequestType.typeSuffix)
    await paymaster.setTrustedForwarder(forwarder.address)

    relayRequest = {
      request: {
        from: senderAddress,
        to: recipient.address,
        nonce: '0',
        value: '0',
        gas: 1e6.toString(),
        data: recipient.contract.methods.test().encodeABI()
      },
      relayData: {
        ...gasData,
        relayWorker,
        paymaster: paymaster.address,
        paymasterData: '0x',
        clientId: '2',
        forwarder: forwarder.address
      }
    }
    proxyAddress = await paymaster.getPayer(relayRequest)
    signature = await getEip712Signature(
      web3,
      new TypedRequestData(
        defaultEnvironment.chainId,
        forwarder.address,
        relayRequest
      )
    )
  })

  context('#preRelayedCall()', function () {
    before(async function () {
      await paymaster.setRelayHub(testHub.address)
    })

    it('should reject if not enough balance', async () => {
      assert.equal(await revertReason(testHub.callPreRC(relayRequest, signature, '0x', 1e6)), 'balance too low -- Reason given: balance too low.')
    })

    context('with token balance at identity address', function () {
      before(async function () {
        await token.mint(1e18.toString())
        await token.transfer(proxyAddress, 1e18.toString())
      })

      it('should reject if not enough balance for value transfer', async () => {
        const relayRequestX = cloneRelayRequest(relayRequest)
        relayRequestX.request.value = 1e18.toString()
        const signatureX = await getEip712Signature(
          web3,
          new TypedRequestData(
            defaultEnvironment.chainId,
            forwarder.address,
            relayRequestX
          )
        )
        assert.equal(await revertReason(testHub.callPreRC(relayRequestX, signatureX, '0x', 1e6)), 'balance too low -- Reason given: balance too low.')
      })

      context('with identity deployed', function () {
        let id: string

        before(async function () {
          id = (await snapshot()).result
          await paymaster.deployProxy(senderAddress)
          await registerAsRelayServer(stakeManager, relayWorker, senderAddress, relayHub)
          await relayHub.depositFor(paymaster.address, { value: 1e18.toString() })
        })

        after(async function () {
          // tests need to deploy the same proxy again
          await revert(id)
        })

        it('should accept if payer is an identity that was not deployed yet', async function () {
          await testHub.callPreRC(relayRequest, signature, '0x', 1e6)
        })

        it('should reject if incorrect signature', async () => {
          const wrongSignature = await getEip712Signature(
            web3,
            new TypedRequestData(
              222,
              forwarder.address,
              relayRequest
            )
          )
          const gas = 5000000
          const relayCall: any = await relayHub.relayCall.call(10e6, relayRequest, wrongSignature, '0x', gas, { from: relayWorker, gas })
          assert.equal(decodeRevertReason(relayCall.returnValue), 'signature mismatch')
        })

        it('should accept because identity gave approval to the paymaster', async function () {
          await testHub.callPreRC(relayRequest, signature, '0x', 1e6)
        })

        context('with token approval withdrawn', function () {
          before(async function () {
            const proxy = await ProxyIdentity.at(proxyAddress)
            const data = token.contract.methods.approve(paymaster.address, 0).encodeABI()
            await proxy.execute(0, token.address, 0, data)
          })

          it('should reject if payer is an already deployed identity and approval is insufficient', async function () {
            assert.equal(await revertReason(testHub.callPreRC(relayRequest, signature, '0x', 1e6)), transferErc20Error)
          })
        })
      })
    })
  })

  context('#preRelayCall()', function () {
    // With GasPrice set to 1 and fees set to 0
    const preChargeEth = 7777
    let id: string

    before(async function () {
      id = (await snapshot()).result
      await token.mint(1e18.toString())
      await token.transfer(proxyAddress, 1e18.toString())
      await paymaster.setRelayHub(relayHub.address)
    })

    after(async function () {
      // tests need to deploy the same proxy again
      await revert(id)
    })

    it('should deploy new identity contract if does not exist, and pre-charge it', async function () {
      await assertDeployed(proxyAddress, false)
      const tx = await paymaster.preRelayedCall(relayRequest, signature, '0x', preChargeEth)
      await assertDeployed(proxyAddress, true)
      await expectEvent.inTransaction(tx.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })
      await expectEvent.inTransaction(tx.tx, TestToken, 'Transfer', {
        from: proxyAddress,
        to: paymaster.address,
        value: (preChargeEth * tokensPerEther).toString()
      })
    })

    it('should not deploy new identity contract if exists, only pre-charge', async function () {
      const code = await web3.eth.getCode(proxyAddress)
      assert.notStrictEqual(code, '0x')
      const tx = await paymaster.preRelayedCall(relayRequest, signature, '0x', preChargeEth)
      await expectEvent.not.inTransaction(tx.tx, ProxyFactory, 'ProxyDeployed', { proxyAddress })
      await expectEvent.inTransaction(tx.tx, TestToken, 'Transfer', {
        from: proxyAddress,
        to: paymaster.address,
        value: (preChargeEth * tokensPerEther).toString()
      })
    })
  })

  context('#postRelayedCall()', function () {
    const preCharge = '3000000'
    const gasUsedByPost = 10000
    let context: string

    before(async function () {
      await token.mint(1e18.toString())
      await token.transfer(paymaster.address, 1e18.toString())
      await paymaster.setRelayHub(relayHub.address)
      await paymaster.setPostGasUsage(gasUsedByPost)
      context = web3.eth.abi.encodeParameters(
        ['address', 'address', 'uint256', 'uint256', 'address', 'address', 'address'],
        [proxyAddress, senderAddress, preCharge, 0, constants.ZERO_ADDRESS, token.address, uniswap.address])
    })

    it('should refund the proxy with the overcharged tokens', async function () {
      const gasUseWithoutPost = 1000000
      const tx = await testHub.callPostRC(paymaster.address, context, gasUseWithoutPost, relayRequest.relayData)
      const gasUsedWithPost = gasUseWithoutPost + gasUsedByPost
      // Repeat on-chain calculation here for sanity
      const actualEtherCharge = (100 + parseInt(relayRequest.relayData.pctRelayFee)) / 100 * gasUsedWithPost
      const actualTokenCharge = actualEtherCharge * tokensPerEther
      const refund = parseInt(preCharge) - actualTokenCharge
      await expectEvent.inTransaction(tx.tx, TestToken, 'Transfer', {
        from: paymaster.address,
        to: proxyAddress,
        value: refund.toString()
      })
      await expectEvent.inTransaction(tx.tx, TestToken, 'Transfer', {
        from: paymaster.address,
        to: uniswap.address,
        value: actualTokenCharge.toString()
      })
      // note that here 'Deposited' is actually emitted by TestHub, beware of API change
      await expectEvent.inTransaction(tx.tx, RelayHub, 'Deposited', {
        paymaster: paymaster.address,
        from: paymaster.address,
        amount: actualEtherCharge.toString()
      })
    })
  })

  // now test for the real flow
  context('#relayedCall()', function () {
    let hub: RelayHubInstance
    let paymaster: ProxyDeployingPaymasterInstance
    let counter: TestCounterInstance
    let proxy: any
    let encodedCall: string

    before(async function () {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const proxyIdentityArtifact = require('../build/contracts/ProxyIdentity')
      // start the GSN
      const host = (web3.currentProvider as HttpProvider).host
      const testEnv = await GsnTestEnvironment.startGsn(host, false)
      // deposit Ether to the RelayHub for paymaster
      // need to convert to any because of namespace collision
      hub = (await RelayHub.at(testEnv.deploymentResult.relayHubAddress)) as any as RelayHubInstance
      paymaster = await ProxyDeployingPaymaster.new([uniswap.address], proxyFactory.address)
      await paymaster.setRelayHub(hub.address)
      await paymaster.setTrustedForwarder(testEnv.deploymentResult.forwarderAddress)
      await hub.depositFor(paymaster.address, {
        value: 1e18.toString()
      })
      // get some tokens for our future proxy. Proxy address only depends on the addresses sender, paymaster and token.
      const relayRequest: RelayRequest = {
        request: {
          to: constants.ZERO_ADDRESS,
          from: senderAddress,
          nonce: '0',
          value: '0',
          data: '0x',
          gas: 1e6.toString()
        },
        relayData: {
          ...gasData,
          relayWorker,
          paymaster: paymaster.address,
          paymasterData: '0x',
          clientId: '2',
          forwarder: testEnv.deploymentResult.forwarderAddress
        }
      }
      proxyAddress = await paymaster.getPayer(relayRequest)
      await token.mint(1e18.toString())
      await token.transfer(proxyAddress, 1e18.toString())
      // deploy test target contract
      counter = await TestCounter.new()
      // create Web3 Contract instance for ProxyIdentity (cannot use truffle artifact if no code deployed)
      await assertDeployed(proxyAddress, false)
      proxy = new web3.eth.Contract(proxyIdentityArtifact.abi, proxyAddress)
      const gsnConfig = {
        relayHubAddress: testEnv.deploymentResult.relayHubAddress,
        forwarderAddress: testEnv.deploymentResult.forwarderAddress,
        stakeManagerAddress: testEnv.deploymentResult.stakeManagerAddress,
        paymasterAddress: paymaster.address
      }
      encodedCall = counter.contract.methods.increment().encodeABI()
      // @ts-expect-error
      const relayProvider = new RelayProvider(web3.currentProvider, gsnConfig)
      proxy.setProvider(relayProvider)
    })

    it('should deploy proxy contract as part of a relay call transaction and charge it with tokens', async function () {
      // Counter should be 0 initially
      const counter1 = await counter.get()
      assert.equal(counter1.toString(), '0')

      // Call counter.increment from identity
      const tx = await proxy.methods.execute(0, counter.address, 0, encodedCall).send({
        from: senderAddress,
        gas: 5000000
      })

      // Check that increment was called
      const counter2 = await counter.get()
      assert.equal(counter2.toString(), '1')
      await expectEvent.inTransaction(tx.transactionHash, ProxyFactory, 'ProxyDeployed', { proxyAddress })
    })

    it('should pay with token to make a call if proxy is deployed', async function () {
      const counter1 = await counter.get()
      assert.equal(counter1.toString(), '1')

      const tx = await proxy.methods.execute(0, counter.address, 0, encodedCall).send({
        from: senderAddress,
        gas: 5000000
      })

      const counter2 = await counter.get()
      assert.equal(counter2.toString(), '2')
      await expectEvent.not.inTransaction(tx.transactionHash, ProxyFactory, 'ProxyDeployed', { proxyAddress })
    })

    it('should convert tokens to ETH and send to Proxy if \'value\' is specified', async function () {
      const counter1 = await counter.get()
      assert.strictEqual(counter1.toString(), '2')

      const balance1 = await web3.eth.getBalance(counter.address)
      assert.strictEqual(balance1, '0')

      const value = 1e16
      await proxy.methods.execute(0, counter.address, value.toString(), encodedCall).send({
        from: senderAddress,
        gas: 5000000,
        value
      })

      const counter2 = await counter.get()
      assert.strictEqual(counter2.toString(), '3')

      const balance2 = await web3.eth.getBalance(counter.address)
      assert.strictEqual(balance2, value.toString(), 'counter did not receive money')
    })
  })
})
