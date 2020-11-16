import GsnTransactionDetails from '@opengsn/gsn/dist/src/relayclient/types/GsnTransactionDetails'
import { RelayClient } from '@opengsn/gsn/dist/src/relayclient/RelayClient'
import { JsonRpcCallback, RelayProvider } from '@opengsn/gsn/dist/src/relayclient/RelayProvider'
import { GSNConfig, GSNDependencies } from '@opengsn/gsn/dist/src/relayclient/GSNConfigurator'
import { Address } from '@opengsn/gsn/dist/src/relayclient/types/Aliases'

import { HttpProvider } from 'web3-core'
import { JsonRpcPayload } from 'web3-core-helpers'

import ProxyIdentityArtifact from './compiled/ProxyIdentity.json'
import IProxyDeployingPaymasterArtifact from './compiled/IProxyDeployingPaymaster.json'

export interface ProxyGSNConfig extends GSNConfig {
  signerAddress: Address
  salt?: number
}

/**
 * a RelayProvider that uses ProxyIdentity account
 * @param signerAccount - this is the account to sign all requests. it will become the owner of proxy account(s)
 * - must be used with ProxyDeployingPaymaster (or subclass)
 * - eth_accounts() return a proxy account that will be seamlessly deployed
 * - (note that this account must have enough tokens to pay for its deployment and for the transactions)
 */
export default class ProxyRelayProvider extends RelayProvider {
  salt: number
  paymasterInstance: any
  proxyContract: any

  constructor (
    origProvider: HttpProvider,
    gsnConfig: Partial<ProxyGSNConfig>,
    overrideDependencies?: Partial<GSNDependencies>,
    relayClient?: RelayClient) {
    super(origProvider,
      gsnConfig,
      overrideDependencies,
      relayClient)

    this.salt = gsnConfig.salt ?? 0
    // @ts-expect-error
    this.paymasterInstance = new this.relayClient.contractInteractor.web3.eth.Contract(IProxyDeployingPaymasterArtifact.abi, this.config.paymasterAddress)
    // @ts-expect-error
    this.proxyContract = new this.relayClient.contractInteractor.web3.eth.Contract(ProxyIdentityArtifact.abi, this.config.paymasterAddress)
  }

  async init (): Promise<this> {
    await super.init()
    await this.udpateProxyAddresses()

    return this
  }

  proxyToSigner: { [proxy: string]: Address } = {}

  // refresh proxyToSigner mapping.
  // MUST be called after account changes (e.g newAccount(), addAccount())
  // (unfortunately, can't be called automatically from within an RPC call..
  async udpateProxyAddresses (): Promise<void> {
    // super is RelayProvider, and it "getAccounts" returns all underlying provider accounts, and all AccountManager's accounts.
    // in any case the list is modified, refresh the proxy address
    const accounts: Address[] = await new Promise((resolve, reject) => {
      super._getAccounts({ id: Date.now(), jsonrpc: '2.0', params: [], method: 'eth_accounts' }, (err, res) => {
        if (err != null) return reject(err)
        resolve(res?.result)
      })
    })
    if (accounts.toString() !== Object.values(this.proxyToSigner).toString()) {
      const proxyToSigner: { [proxy: string]: Address } = {}
      // TODO: should cache and re-use previously resolved addresses, instead of re-resolve all, though the list should be small anyways
      // TODO: create javascript calculateAddress, to avoid async call.
      const proxies: Address[] = await Promise.all(accounts.map(acct => this.paymasterInstance.methods.calculateAddress(acct, this.salt).call()))
      for (let i = 0; i < proxies.length; i++) {
        proxyToSigner[proxies[i].toLowerCase()] = accounts[i]
      }

      this.proxyToSigner = proxyToSigner
    }
  }

  _getAccounts (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    callback(null, {
      id: payload.id as number,
      jsonrpc: payload.jsonrpc,
      result: Object.keys(this.proxyToSigner)
    })
  }

  _ethSendTransaction (payload: JsonRpcPayload, callback: JsonRpcCallback): void {
    const gsnTransactionDetails: GsnTransactionDetails = payload.params[0]
    const proxy = gsnTransactionDetails.from

    // TODO: this assumes we never change proxy owner (that is, rely on create2 address before and after
    // proxy deployment)
    // if proxy is deployed, we can fetch proxy.owner() - and then validates it is one of our signer accounts.
    const signer = this.proxyToSigner[proxy.toLowerCase()]

    if (signer == null) {
      callback(new Error(`invalid from (${gsnTransactionDetails.from}: should be our proxy: ${JSON.stringify(this.proxyToSigner)}`))
      return
    }
    const proxyTransactionDetails = {
      ...gsnTransactionDetails,
      from: signer,
      to: proxy,
      data: this.proxyContract.methods.execute(0, gsnTransactionDetails.to, gsnTransactionDetails.value ?? 0, gsnTransactionDetails.data).encodeABI()
    }
    const proxyPayload = {
      ...payload,
      params: [proxyTransactionDetails]
    }
    super._ethSendTransaction(proxyPayload, callback)
  }
}
