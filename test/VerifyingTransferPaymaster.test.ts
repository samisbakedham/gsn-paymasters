import { bufferToHex, privateToAddress } from 'ethereumjs-util'
import { randomBytes } from 'crypto'

import { GSNConfig } from '@opengsn/gsn/dist/src/relayclient/GSNConfigurator'
import { GsnTestEnvironment } from '@opengsn/gsn/dist/GsnTestEnvironment'
import { RelayProvider } from '@opengsn/gsn'

import {
  IRelayHubInstance,
  SampleRecipientInstance,
  VerifyingTransferPaymasterInstance
} from '../types/truffle-contracts'
import { toBN } from 'web3-utils'
import { signRelayRequest } from '../src/VerifyingPaymasterUtils'
import RelayRequest from '@opengsn/gsn/dist/src/common/EIP712/RelayRequest'
import { expectEvent } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'

const IRelayHub = artifacts.require('IRelayHub')
const SampleRecipient = artifacts.require('SampleRecipient')
const VerifyingTransferPaymaster = artifacts.require('VerifyingTransferPaymaster')

contract('VerifyingPaymaster', ([from]) => {
  let hubInstance: IRelayHubInstance
  let paymasterInstance: VerifyingTransferPaymasterInstance
  let sampleRecipientInstance: SampleRecipientInstance
  let privateKey: Buffer
  let signer: string

  before(async () => {
    privateKey = randomBytes(32)
    signer = bufferToHex(privateToAddress(privateKey))

    const {
      deploymentResult: {
        relayHubAddress,
        forwarderAddress
      }
    } = await GsnTestEnvironment.startGsn('localhost')

    hubInstance = await IRelayHub.at(relayHubAddress)
    sampleRecipientInstance = await SampleRecipient.new()
    paymasterInstance = await VerifyingTransferPaymaster.new()

    await paymasterInstance.setRelayHub(relayHubAddress)
    await paymasterInstance.setTrustedForwarder(forwarderAddress)
    await sampleRecipientInstance.setForwarder(forwarderAddress)
    await paymasterInstance.setSigner(signer)

    // note: this money stays in paymaster itself to make value transfers
    await web3.eth.sendTransaction({ from, to: paymasterInstance.address, value: 1e18 })
    await hubInstance.depositFor(paymasterInstance.address, { from, value: toBN(1e18) })

    const gsnConfig: Partial<GSNConfig> = {
      logLevel: 5,
      relayHubAddress,
      forwarderAddress,
      paymasterAddress: paymasterInstance.address
    }
    const relayProvider = new RelayProvider(web3.currentProvider as HttpProvider, gsnConfig, {
      asyncApprovalData: async (relayRequest: RelayRequest) => signRelayRequest(relayRequest, privateKey)
    })

    // @ts-expect-error
    SampleRecipient.web3.setProvider(relayProvider)
  })

  describe('attempt relay', () => {
    it('should succeed and send required amount of ether through the Forwarder', async () => {
      const value = toBN(1e17)
      const tx = await sampleRecipientInstance.somethingPayable({
        value
      })
      await expectEvent.inTransaction(tx.tx, SampleRecipient, 'ReceivedValue', {
        value
      })
    })
  })
})
