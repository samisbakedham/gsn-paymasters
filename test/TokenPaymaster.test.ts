/* global contract artifacts before it */

import { constants } from '@openzeppelin/test-helpers'
import TypedRequestData, { GsnRequestType } from '@opengsn/gsn/dist/src/common/EIP712/TypedRequestData'
import RelayRequest, { cloneRelayRequest } from '@opengsn/gsn/dist/src/common/EIP712/RelayRequest'
import { defaultEnvironment } from '@opengsn/gsn/dist/src/relayclient/types/Environments'
import { getEip712Signature } from '@opengsn/gsn/dist/src/common/Utils'
import { PrefixedHexString } from 'ethereumjs-tx'

import {
  PenalizerInstance,
  RelayHubInstance,
  StakeManagerInstance,
  TestProxyInstance,
  TestTokenInstance,
  TestUniswapInstance,
  TokenPaymasterInstance,
  IForwarderInstance
} from '../types/truffle-contracts'
import { registerAsRelayServer, revertReason } from './TestUtils'

const TokenPaymaster = artifacts.require('TokenPaymaster')
const TokenGasCalculator = artifacts.require('TokenGasCalculator')
const TestUniswap = artifacts.require('TestUniswap')
const TestToken = artifacts.require('TestToken')
const RelayHub = artifacts.require('RelayHub')
const Forwarder = artifacts.require('Forwarder')
const StakeManager = artifacts.require('StakeManager')
const Penalizer = artifacts.require('Penalizer')
const TestProxy = artifacts.require('TestProxy')

contract('TokenPaymaster', ([from, relay, relayOwner]) => {
  let paymaster: TokenPaymasterInstance
  let uniswap: TestUniswapInstance
  let token: TestTokenInstance
  let recipient: TestProxyInstance
  let hub: RelayHubInstance
  let forwarder: IForwarderInstance
  let stakeManager: StakeManagerInstance
  let penalizer: PenalizerInstance
  let relayRequest: RelayRequest
  let signature: PrefixedHexString

  async function calculatePostGas (paymaster: TokenPaymasterInstance): Promise<void> {
    const uniswap = await paymaster.uniswap()
    const testpaymaster = await TokenPaymaster.new([uniswap], { gas: 1e7 })
    const calc = await TokenGasCalculator.new(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, { gas: 10000000 })
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
      gas: 1e7
    })
    stakeManager = await StakeManager.new()
    penalizer = await Penalizer.new()
    hub = await RelayHub.new(stakeManager.address, penalizer.address)
    token = await TestToken.at(await uniswap.tokenAddress())

    paymaster = await TokenPaymaster.new([uniswap.address], { gas: 1e7 })
    await calculatePostGas(paymaster)
    await paymaster.setRelayHub(hub.address)

    console.log('paymaster post with precharge=', await paymaster.gasUsedByPost.toString())
    forwarder = await Forwarder.new({ gas: 1e7 })
    recipient = await TestProxy.new(forwarder.address, { gas: 1e7 })

    await forwarder.registerRequestType(GsnRequestType.typeName, GsnRequestType.typeSuffix)
    await paymaster.setTrustedForwarder(forwarder.address)
    // approve uniswap to take our tokens.
    await token.approve(uniswap.address, -1)

    relayRequest = {
      relayData: {
        relayWorker: relay,
        paymaster: paymaster.address,
        forwarder: forwarder.address,
        paymasterData: '0x',
        clientId: '0',
        pctRelayFee: '1',
        baseRelayFee: '0',
        gasPrice: await web3.eth.getGasPrice()
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

  context('#acceptRelayedCall()', function () {
    it('should reject if incorrect signature', async () => {
      const wrongSignature = await getEip712Signature(
        web3,
        new TypedRequestData(
          222,
          forwarder.address,
          relayRequest
        )
      )
      assert.equal(await revertReason(paymaster.acceptRelayedCall(relayRequest, wrongSignature, '0x', 1e6)), 'signature mismatch')
    })

    it('should reject if not enough balance', async () => {
      assert.equal(await revertReason(paymaster.acceptRelayedCall(relayRequest, signature, '0x', 1e6)), 'balance too low')
    })

    context('with funded recipient', function () {
      before(async function () {
        await token.mint(5e18.toString())
        await token.transfer(recipient.address, 5e18.toString())
      })

      it('should reject if no token approval', async () => {
        assert.include(await revertReason(paymaster.acceptRelayedCall(relayRequest, signature, '0x', 1e6)), 'allowance too low')
      })

      context('with token approved for paymaster', function () {
        before(async function () {
          await recipient.execute(token.address, token.contract.methods.approve(paymaster.address, -1).encodeABI())
        })

        it('should succeed acceptRelayedCall', async () => {
          await paymaster.acceptRelayedCall(relayRequest, signature, '0x', 1e6)
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

      const chainId = defaultEnvironment.chainId
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
      const ret = await hub.relayCall(_relayRequest, signature, '0x', externalGasLimit, {
        from: relay,
        gasPrice: 1,
        gas: externalGasLimit
      })

      const relayed = ret.logs.find(log => log.event === 'TransactionRelayed')
      // @ts-ignore
      const events = await paymaster.getPastEvents()
      const chargedEvent = events.find((e: any) => e.event === 'TokensCharged')

      console.log({ relayed, chargedEvent })
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
        `expected paymaster balance not to be reduced: pre=${preBalance.toString()} post=${postBalance.toString()}`)
      // TODO: add test for relayed.args.charge, once gasUsedWithoutPost parameter is fixed (currently, its too high, and Paymaster "charges" too much)
      const postPaymasterTokens = await token.balanceOf(paymaster.address)
      console.log('Paymaster "earned" tokens:', postPaymasterTokens.sub(prePaymasterTokens).toString())
      console.log('Paymaster "earned" deposit on RelayHub:', postBalance.sub(preBalance).toString())
    })
  })
})
