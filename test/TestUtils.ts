import { RelayHubInstance, StakeManagerInstance } from '../types/truffle-contracts'

export async function revertReason (func: Promise<any>): Promise<string> {
  try {
    await func
    return 'ok' // no revert
  } catch (e) {
    return e.message.replace(/.*revert /, '')
  }
}

export async function registerAsRelayServer (stakeManager: StakeManagerInstance, relay: string, relayOwner: string, hub: RelayHubInstance): Promise<void> {
  await stakeManager.stakeForAddress(relay, 7 * 24 * 3600, {
    from: relayOwner,
    value: (2e18).toString()
  })
  await stakeManager.authorizeHubByOwner(relay, hub.address, { from: relayOwner })
  await hub.addRelayWorkers([relay], { from: relay })
  await hub.registerRelayServer(2e16.toString(), '10', 'url', { from: relay })
}
