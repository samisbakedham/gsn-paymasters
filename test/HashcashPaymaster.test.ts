import {
  createHashcashAsyncApproval, calculateHashcashApproval, calculateHashcash
} from '../src/HashCashApproval'
import { HashcashPaymasterInstance, SampleRecipientInstance } from '../types/truffle-contracts'
import { GSNConfig, RelayProvider } from '@opengsn/gsn'
import RelayRequest from '@opengsn/gsn/dist/src/common/EIP712/RelayRequest'

import { GsnTestEnvironment } from '@opengsn/gsn/dist/src/relayclient/GsnTestEnvironment'
import { expectRevert } from '@openzeppelin/test-helpers'
import { HttpProvider } from 'web3-core'
import { GSNUnresolvedConstructorInput } from '@opengsn/gsn/dist/src/relayclient/RelayClient'
import { HttpServer } from '@opengsn/gsn/dist/src/relayserver/HttpServer'

const HashcashPaymaster = artifacts.require('HashcashPaymaster')
const SampleRecipient = artifacts.require('SampleRecipient')

contract('HashcashPaymaster', ([from]) => {
  let pm: HashcashPaymasterInstance
  let s: SampleRecipientInstance
  let gsnConfig: Partial<GSNConfig>
  let relayHubAddress: string | undefined
  let forwarderAddress: string | undefined
  let httpServer: HttpServer

  before(async () => {
    ({
      httpServer,
      contractsDeployment: {
        relayHubAddress,
        forwarderAddress
      }
    } = await GsnTestEnvironment.startGsn('localhost'))

    // TODO: fix
    // @ts-expect-error
    httpServer.relayService?.config.checkInterval = 1000

    s = await SampleRecipient.new()
    await s.setForwarder(forwarderAddress!)

    pm = await HashcashPaymaster.new(10)
    await pm.setRelayHub(relayHubAddress!)
    await pm.setTrustedForwarder(forwarderAddress!)
    await web3.eth.sendTransaction({ from, to: pm.address, value: 1e18 })

    gsnConfig = {
      loggerConfiguration: {
        logLevel: 'error'
      },
      paymasterAddress: pm.address
    }
  })

  it('should fail to send without approvalData', async () => {
    const input: GSNUnresolvedConstructorInput = {
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig
    }
    const p = RelayProvider.newProvider(input)
    await p.init()
    // @ts-expect-error
    SampleRecipient.web3.setProvider(p)
    await expectRevert(s.something(), 'no hash in approvalData')
  })

  it('should fail with no wrong hash', async () => {
    const input: GSNUnresolvedConstructorInput = {
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: async () => '0x'.padEnd(2 + 64 * 2, '0')
        }
    }
    const p = RelayProvider.newProvider(input)
    await p.init()
    // @ts-expect-error
    SampleRecipient.web3.setProvider(p)

    await expectRevert(s.something(), 'wrong hash')
  })

  it('should fail low difficulty', async () => {
    const input: GSNUnresolvedConstructorInput = {
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: createHashcashAsyncApproval(1)
        }
    }
    const p = RelayProvider.newProvider(input)
    await p.init()
    // @ts-expect-error
    SampleRecipient.web3.setProvider(p)

    return expectRevert(s.something(), 'difficulty not met')
  })

  it('should succeed with proper difficulty', async function () {
    this.timeout(35000)

    const input: GSNUnresolvedConstructorInput = {
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: createHashcashAsyncApproval(15)
        }
    }
    const p = RelayProvider.newProvider(input)
    await p.init()
    // @ts-expect-error
    SampleRecipient.web3.setProvider(p)

    await s.something()
    await s.something()
    await s.something()
  })

  it('calculateHashCash should call periodically a callback', async () => {
    let counter = 0

    function cb (): boolean {
      counter++
      return true
    }

    // 15 bit difficulty 2^12 =~ 4096. avg counter 2000
    await calculateHashcash('0x'.padEnd(42, '1'), '1', 12, 1000, cb)
    assert.isAtLeast(counter, 3)
  })

  it('should calculate approval in advance', async () => {
    const approval = await calculateHashcashApproval(web3, from, s.address, forwarderAddress ?? '', pm.address)
    console.log('approval=', approval)
    const input: GSNUnresolvedConstructorInput = {
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig,
      overrideDependencies: {
        asyncApprovalData: async (req: RelayRequest) => {
          // console.log('req=', req)
          return approval!
        }
      }
    }
    const p = RelayProvider.newProvider(input)
    await p.init()
    // @ts-expect-error
    SampleRecipient.web3.setProvider(p)

    await s.something()
  })
  it('should refuse to reuse the same approvalData', async function () {
    this.timeout(35000)
    // read next valid hashash approval data, and always return it.
    const approvalfunc = createHashcashAsyncApproval(15)
    let saveret: string

    const input: GSNUnresolvedConstructorInput = {
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: async (request: RelayRequest) => {
            saveret = await approvalfunc(request) ?? ''
            return saveret
          }
        }
    }
    const p = RelayProvider.newProvider(input)
    await p.init()
    // @ts-expect-error
    SampleRecipient.web3.setProvider(p)
    await s.something()

    const input1: GSNUnresolvedConstructorInput = {
      provider: web3.currentProvider as HttpProvider,
      config: gsnConfig,
      overrideDependencies:
        {
          asyncApprovalData: async (req: RelayRequest) => saveret
        }
    }
    const p1 = RelayProvider.newProvider(input1)
    await p1.init()
    // @ts-expect-error
    SampleRecipient.web3.setProvider(p1)
    return expectRevert(s.something(), 'wrong hash')
  })
})
