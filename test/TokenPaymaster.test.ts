/* global contract artifacts before it */

import { constants } from '@openzeppelin/test-helpers'
import TypedRequestData, {
  GsnDomainSeparatorType,
  GsnRequestType
} from '@opengsn/gsn/dist/src/common/EIP712/TypedRequestData'
import RelayRequest, { cloneRelayRequest } from '@opengsn/gsn/dist/src/common/EIP712/RelayRequest'
import { defaultEnvironment } from '@opengsn/gsn/dist/src/common/Environments'
import { decodeRevertReason, getEip712Signature } from '@opengsn/gsn/dist/src/common/Utils'
import { deployHub } from '@opengsn/gsn/dist/test/TestUtils'
import { PrefixedHexString } from 'ethereumjs-tx'

import {
  IPenalizerInstance,
  IStakeManagerInstance,
  TestProxyInstance,
  TestTokenInstance,
  TestUniswapInstance,
  TokenPaymasterInstance,
  IForwarderInstance, TestHubInstance
} from '../types/truffle-contracts'
import { registerAsRelayServer, revertReason } from './TestUtils'
import RelayData from '@opengsn/gsn/dist/src/common/EIP712/RelayData'
import { RelayHubInstance } from '@opengsn/gsn/dist/types/truffle-contracts'
import Web3 from 'web3'
import { GsnTestEnvironment } from '@opengsn/gsn/dist/src/relayclient/GsnTestEnvironment'

const TestHub = artifacts.require('TestHub')
const TokenPaymaster = artifacts.require('TokenPaymaster')
const TokenGasCalculator = artifacts.require('TokenGasCalculator')
const TestUniswap = artifacts.require('TestUniswap')
const TestToken = artifacts.require('TestToken')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestProxy = artifacts.require('TestProxy')

export const transferErc20Error = 'ERC20: transfer amount exceeds allowance -- Reason given: ERC20: transfer amount exceeds allowance.'

function mergeData (req: RelayRequest, override: Partial<RelayData>): RelayRequest {
  return {
    request: req.request,
    relayData: { ...req.relayData, ...override }
  }
}

contract('TokenPaymaster', ([from, relay, relayOwner, nonUniswap]) => {
  let paymaster: TokenPaymasterInstance
  let uniswap: TestUniswapInstance
  let token: TestTokenInstance
  let recipient: TestProxyInstance
  let hub: RelayHubInstance
  let forwarder: IForwarderInstance
  let stakeManager: IStakeManagerInstance
  let penalizer: IPenalizerInstance
  let relayRequest: RelayRequest
  let signature: PrefixedHexString

  async function calculatePostGas (paymaster: TokenPaymasterInstance): Promise<void> {
    const uniswap = await paymaster.uniswaps(0)
    const testpaymaster = await TokenPaymaster.new([uniswap], { gas: 1e7 })
    const calc = await TokenGasCalculator.new(
      constants.ZERO_ADDRESS,
      constants.ZERO_ADDRESS,
      defaultEnvironment.relayHubConfiguration.maxWorkerCount,
      defaultEnvironment.relayHubConfiguration.gasReserve,
      defaultEnvironment.relayHubConfiguration.postOverhead,
      defaultEnvironment.relayHubConfiguration.gasOverhead,
      defaultEnvironment.relayHubConfiguration.maximumRecipientDeposit,
      defaultEnvironment.relayHubConfiguration.minimumUnstakeDelay,
      defaultEnvironment.relayHubConfiguration.minimumStake,
      { gas: 10000000 })
    await testpaymaster.transferOwnership(calc.address)
    // put some tokens in paymaster so it can calculate postRelayedCall gas usage:
    await token.mint(1e18.toString())
    await token.transfer(calc.address, 1e18.toString())
    const gasUsedByPost = await calc.calculatePostGas.call(testpaymaster.address)
    console.log('post calculator:', gasUsedByPost.toString())
    await paymaster.setPostGasUsage(gasUsedByPost)
  }

  before(async () => {
    // exchange rate 2 tokens per eth.
    uniswap = await TestUniswap.new(2, 1, {
      value: (5e18).toString(),
      gas: 10000000
    })
    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    hub = await deployHub(stakeManager.address, penalizer.address)
    token = await TestToken.at(await uniswap.tokenAddress())

    paymaster = await TokenPaymaster.new([uniswap.address], { gas: 1e7 })
    await calculatePostGas(paymaster)
    await paymaster.setRelayHub(hub.address)

    console.log('paymaster post with precharge=', (await paymaster.gasUsedByPost()).toString())
    forwarder = await Forwarder.new({ gas: 1e7 })
    recipient = await TestProxy.new(forwarder.address, { gas: 1e7 })

    await forwarder.registerRequestType(GsnRequestType.typeName, GsnRequestType.typeSuffix)
    await forwarder.registerDomainSeparator(GsnDomainSeparatorType.name, GsnDomainSeparatorType.version)
    await paymaster.setTrustedForwarder(forwarder.address)
    // approve uniswap to take our tokens.
    await token.approve(uniswap.address, -1)

    relayRequest = {
      relayData: {
        relayWorker: relay,
        paymaster: paymaster.address,
        forwarder: forwarder.address,
        pctRelayFee: '1',
        baseRelayFee: '0',
        gasPrice: await web3.eth.getGasPrice(),
        paymasterData: '0x',
        clientId: '1'
      },
      request: {
        data: recipient.contract.methods.test().encodeABI(),
        nonce: '0',
        value: '0',
        from,
        to: recipient.address,
        gas: 1e6.toString()
      }
    }

    const chainId = defaultEnvironment.chainId
    const dataToSign = new TypedRequestData(
      chainId,
      forwarder.address,
      relayRequest
    )
    signature = await getEip712Signature(
      web3,
      dataToSign
    )
  })

  after(async function () {
    await GsnTestEnvironment.stopGsn()
  })

  context('#preRelayedCall', function () {
    let testHub: TestHubInstance
    context('revert reasons', function () {
      before(async function () {
        testHub = await TestHub.new(
          constants.ZERO_ADDRESS,
          constants.ZERO_ADDRESS,
          defaultEnvironment.relayHubConfiguration.maxWorkerCount,
          defaultEnvironment.relayHubConfiguration.gasReserve,
          defaultEnvironment.relayHubConfiguration.postOverhead,
          defaultEnvironment.relayHubConfiguration.gasOverhead,
          defaultEnvironment.relayHubConfiguration.maximumRecipientDeposit,
          defaultEnvironment.relayHubConfiguration.minimumUnstakeDelay,
          defaultEnvironment.relayHubConfiguration.minimumStake,
          { gas: 10000000 })
        await paymaster.setRelayHub(testHub.address)
      })

      it('should reject if not enough balance', async () => {
        assert.match(await revertReason(testHub.callPreRC(relayRequest, signature, '0x', 1e6)), /ERC20: transfer amount exceeds balance/)
      })

      it('should reject if unknown paymasterData', async () => {
        const req = mergeData(relayRequest, { paymasterData: '0x1234' })
        const signature = await getEip712Signature(web3, new TypedRequestData(1, forwarder.address, req))
        assert.equal(await revertReason(testHub.callPreRC(req, signature, '0x', 1e6)), 'invalid uniswap address in paymasterData -- Reason given: invalid uniswap address in paymasterData.')
      })

      it('should reject if unsupported uniswap in paymasterData', async () => {
        const req = mergeData(relayRequest, { paymasterData: web3.eth.abi.encodeParameter('address', nonUniswap) })
        const signature = await getEip712Signature(web3, new TypedRequestData(1, forwarder.address, req))
        assert.equal(await revertReason(testHub.callPreRC(req, signature, '0x', 1e6)), 'unsupported token uniswap -- Reason given: unsupported token uniswap.')
      })
    })

    context('with funded recipient', function () {
      before(async function () {
        await token.mint(5e18.toString())
        await token.transfer(recipient.address, 5e18.toString())
      })

      it('should reject if no token approval', async () => {
        assert.include(await revertReason(testHub.callPreRC(relayRequest, signature, '0x', 1e6)), transferErc20Error)
      })

      context('with token approved for paymaster', function () {
        before(async function () {
          await recipient.execute(token.address, token.contract.methods.approve(paymaster.address, -1).encodeABI())
        })

        it('callPreRC should succeed and return default token/uniswap', async () => {
          const ret: any = await testHub.callPreRC.call(relayRequest, signature, '0x', 1e6)
          const decoded = web3.eth.abi.decodeParameters(['address', 'address', 'address', 'address'], ret.context)
          assert.equal(decoded[2], token.address)
          assert.equal(decoded[3], uniswap.address)
        })

        it('callPreRC should succeed with specific token/uniswap', async () => {
          const req = mergeData(relayRequest, { paymasterData: web3.eth.abi.encodeParameter('address', uniswap.address) })
          const signature = await getEip712Signature(web3, new TypedRequestData(1, forwarder.address, req))
          const ret: any = await testHub.callPreRC.call(req, signature, '0x', 1e6)
          const decoded = web3.eth.abi.decodeParameters(['address', 'address', 'address', 'address'], ret.context) as any
          assert.equal(decoded[2], token.address)
          assert.equal(decoded[3], uniswap.address)
        })
      })
    })
  })

  context('#relayedCall()', function () {
    const paymasterDeposit = 1e18.toString()

    before(async () => {
      // TODO: not needed. use startGsn instead
      await registerAsRelayServer(stakeManager, relay, relayOwner, hub)
      await hub.depositFor(paymaster.address, { value: paymasterDeposit })
      await paymaster.setRelayHub(hub.address)
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
      const relayCall: any = await hub.relayCall.call(1e06, relayRequest, wrongSignature, '0x', gas, { from: relay, gas })
      assert.equal(decodeRevertReason(relayCall.returnValue), 'signature mismatch')
    })

    it('should pay with token to make a call', async function () {
      const preTokens = await token.balanceOf(recipient.address)
      const prePaymasterTokens = await token.balanceOf(paymaster.address)
      // for simpler calculations: we don't take any fee, and gas price is '1', so actual charge
      // should be exactly gas usage. token is 2:1 to eth, so we expect to pay exactly twice the "charge"
      const _relayRequest = cloneRelayRequest(relayRequest)
      _relayRequest.request.from = from
      _relayRequest.request.nonce = (await forwarder.getNonce(from)).toString()
      _relayRequest.relayData.gasPrice = '1'
      _relayRequest.relayData.pctRelayFee = '0'
      _relayRequest.relayData.baseRelayFee = '0'

      // note that by default, ganache is buggy: getChainId returns 1337 but on-chain "chainid" returns 1.
      // only if we pass it "--chainId 1337" the above 2 return the same value...
      const chainId = await new Web3(web3.currentProvider as any).eth.getChainId()

      const dataToSign = new TypedRequestData(
        chainId,
        forwarder.address,
        _relayRequest
      )
      const signature = await getEip712Signature(
        web3,
        dataToSign
      )

      const preBalance = await hub.balanceOf(paymaster.address)

      const externalGasLimit = 5e6.toString()
      const ret = await hub.relayCall(10e6, _relayRequest, signature, '0x', externalGasLimit, {
        from: relay,
        gasPrice: 1,
        gas: externalGasLimit
      })

      const rejected = ret.logs.find(log => log.event === 'TransactionRejectedByPaymaster')
      assert.ok(rejected == null, `Rejected with reason: ${decodeRevertReason(rejected?.args.reason) as string}`)
      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      // @ts-expect-error
      const events = await paymaster.getPastEvents()
      const chargedEvent = events.find((e: any) => e.event === 'TokensCharged')

      // console.log({ relayed, chargedEvent })
      console.log('charged: ', relayed!.args.charge.toString())
      assert.equal(relayed!.args.status, 0)
      const postTokens = await token.balanceOf(recipient.address)
      const usedTokens = preTokens.sub(postTokens)

      console.log('recipient tokens balance change (used tokens): ', usedTokens.toString())
      console.log('reported charged tokens in TokensCharged: ', chargedEvent.args.tokenActualCharge.toString())
      const expectedTokenCharge = await uniswap.getTokenToEthOutputPrice(chargedEvent.args.ethActualCharge)
      assert.closeTo(usedTokens.toNumber(), expectedTokenCharge.toNumber(), 1000)
      const postBalance = await hub.balanceOf(paymaster.address)

      assert.ok(postBalance >= preBalance,
        `expected paymaster balance not to be reduced: pre=${preBalance.toString() as string} post=${postBalance.toString() as string}`)
      // TODO: add test for relayed.args.charge, once gasUsedWithoutPost parameter is fixed (currently, its too high, and Paymaster "charges" too much)
      const postPaymasterTokens = await token.balanceOf(paymaster.address)
      console.log('Paymaster "earned" tokens:', postPaymasterTokens.sub(prePaymasterTokens).toString())
      console.log('Paymaster "earned" deposit on RelayHub:', postBalance.sub(preBalance).toString())
    })
  })
})
