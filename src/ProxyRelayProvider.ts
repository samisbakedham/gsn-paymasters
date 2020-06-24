import GsnTransactionDetails from '@opengsn/gsn/dist/src/relayclient/types/GsnTransactionDetails'
import RelayClient from '@opengsn/gsn/dist/src/relayclient/RelayClient'
import { JsonRpcCallback, RelayProvider } from '@opengsn/gsn/dist/src/relayclient/RelayProvider'
import { GSNConfig, GSNDependencies } from '@opengsn/gsn/dist/src/relayclient/GSNConfigurator'
import { Address } from '@opengsn/gsn/dist/src/relayclient/types/Aliases'

import { HttpProvider } from 'web3-core'
import { JsonRpcPayload } from 'web3-core-helpers'
import Contract from 'web3-eth-contract'
import { keccak256 } from 'web3-utils'
import abi from 'web3-eth-abi'
import { removeHexPrefix } from '@opengsn/gsn/dist/src/common/Utils'

import ProxyIdentityArtifact from './compiled/ProxyIdentity.json'

export default class ProxyRelayProvider extends RelayProvider {
  private readonly proxyFactory: Address

  constructor (
    proxyFactory: Address,
    origProvider: HttpProvider,
    gsnConfig: Partial<GSNConfig>,
    overrideDependencies?: Partial<GSNDependencies>,
    relayClient?: RelayClient) {
    super(origProvider,
      gsnConfig,
      overrideDependencies,
      relayClient)
    this.proxyFactory = proxyFactory
  }

  _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    const proxyAddress = this._calculateProxyAddress(gsnTransactionDetails.from, 0)
    // @ts-ignore
    const proxy = new Contract(ProxyIdentityArtifact.abi, proxyAddress)
    payload.params[0].data = proxy.methods.execute(0, gsnTransactionDetails.to, 0, gsnTransactionDetails.data).encodeABI()
    payload.params[0].to = proxyAddress
    super._ethSendTransaction(payload, callback)
  }

  // @ts-ignore
  _calculateProxyAddress (owner: Address, salt: number): Address {
    const ff = '0xff'
    const deployingAddress = removeHexPrefix(this.proxyFactory).toLowerCase()
    const bytecode = ProxyIdentityArtifact.bytecode
    // @ts-ignore
    const constructorParameters = removeHexPrefix(abi.encodeParameters(['address'], [owner])).toLowerCase()
    const initCode = bytecode.concat(constructorParameters).toLowerCase()
    const bytecodeHash = removeHexPrefix(keccak256(initCode)).toLowerCase()
    const saltToBytes = salt.toString(16).padStart(64, '0')
    const concatString = ff.concat(deployingAddress).concat(saltToBytes).concat(bytecodeHash)
    const hashed = keccak256(concatString)
    return '0x' + hashed.substr(26)
  }
}
