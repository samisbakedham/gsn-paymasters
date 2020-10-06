import { SampleRecipientInstance, VerifyingPaymasterInstance } from '../types/truffle-contracts'

import { RelayProvider } from '@opengsn/gsn'
import { GsnTestEnvironment } from '@opengsn/gsn/dist/GsnTestEnvironment'
import { expectRevert } from '@openzeppelin/test-helpers'
import { GSNConfig } from '@opengsn/gsn/dist/src/relayclient/GSNConfigurator'
import RelayRequest from '@opengsn/gsn/dist/src/common/EIP712/RelayRequest'
import { PrefixedHexString } from 'ethereumjs-tx'
import { AsyncDataCallback } from '@opengsn/gsn/dist/src/relayclient/types/Aliases'
import { bufferToHex, privateToAddress } from 'ethereumjs-util'
import { randomBytes } from 'crypto'
import { getRequestHash, packForwardRequest, packRelayData, signRelayRequest } from '../src/VerifyingPaymasterUtils'

const VerifyingPaymaster = artifacts.require('VerifyingPaymaster')
const SampleRecipient = artifacts.require('SampleRecipient')

contract('VerifyingPaymaster', ([from]) => {
  describe('#getRequestHash', () => {
    let req: RelayRequest
    let pm: VerifyingPaymasterInstance
    before(async () => {
      pm = await VerifyingPaymaster.new()
      // sample request, just to verify our solidity and javascript hash functions match
      req = {
        request: {
          to: '0x'.padEnd(42, '1'),
          data: '0xa7a0d537',
          from: '0x'.padEnd(42, '2'),
          value: '1',
          nonce: '2',
          gas: '3'
        },
        relayData: {
          pctRelayFee: '3',
          baseRelayFee: '4',
          gasPrice: '5',
          paymaster: '0x'.padEnd(42, '3'),
          paymasterData: '0x',
          clientId: '6',
          forwarder: '0x'.padEnd(42, '4'),
          relayWorker: '0x'.padEnd(42, '5')
        }
      }
    })

    it('#packForwardRequest', async () => {
      assert.equal(packForwardRequest(req.request), await pm.packForwardRequest(req.request))
    })

    it('#packRelayRequest', async () => {
      assert.equal(packRelayData(req.relayData), await pm.packRelayData(req.relayData))
    })

    it('should return same hash', async () => {
      assert.equal((bufferToHex(getRequestHash(req))), await pm.getRequestHash(req))
    })
  })

  describe('attempt relay', () => {
    let pm: VerifyingPaymasterInstance
    let s: SampleRecipientInstance
    let gsnConfig: Partial<GSNConfig>

    let privkey: Buffer
    let signer: string

    let mockApprovalFunc: AsyncDataCallback

    // simulated call to backend, to verify request
    async function mockGetApprovalData (relayRequest: RelayRequest): Promise<PrefixedHexString> {
      return await mockApprovalFunc(relayRequest)
    }

    before(async () => {
      privkey = randomBytes(32)
      signer = bufferToHex(privateToAddress(privkey))

      const {
        deploymentResult: {
          relayHubAddress,
          forwarderAddress
        }
      } = await GsnTestEnvironment.startGsn('localhost')

      s = await SampleRecipient.new()
      await s.setForwarder(forwarderAddress)

      pm = await VerifyingPaymaster.new()
      await pm.setRelayHub(relayHubAddress)
      await pm.setTrustedForwarder(forwarderAddress)

      await pm.setSigner(signer)

      await web3.eth.sendTransaction({ from, to: pm.address, value: 1e18 })

      gsnConfig = {
        logLevel: 5,
        relayHubAddress,
        forwarderAddress,
        paymasterAddress: pm.address
      }
      const p = new RelayProvider(web3.currentProvider as any, gsnConfig, {
        asyncApprovalData: mockGetApprovalData
      })
      // @ts-expect-error
      SampleRecipient.web3.setProvider(p)
    })

    it('should fail without approval data', async () => {
      mockApprovalFunc = async () => '0x'
      await expectRevert(s.something(), 'invalid approvalData signature')
    })

    it('should fail with invalid approval data', async () => {
      mockApprovalFunc = async () => '0xdeadface'
      await expectRevert(s.something(), 'invalid approvalData signature')
    })

    it('should fail with wrong in signature approval data', async () => {
      mockApprovalFunc = async () => '0x'.padEnd(65 * 2 + 2, '1c')
      await expectRevert(s.something(), 'invalid signature')
    })

    it('should succeed with valid approval signature', async () => {
      // this is a sample callback that should be on a server.
      // after verifying the request, the server signs it so the client will be approved by the paymaster.
      // note that the server doesn't have to check the client's signature: if the client's signature fails,
      // then the request will also fail (by the forwarder), regardless of this approval signature.
      mockApprovalFunc = async (relayRequest: RelayRequest) => {
        return signRelayRequest(relayRequest, privkey)
      }

      await s.something()
    })
  })
})
