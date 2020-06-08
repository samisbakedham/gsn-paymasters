import {keccak256, toBN} from 'web3-utils'
import RelayRequest from "@opengsn/gsn/dist/src/common/EIP712/RelayRequest"
import abi from 'web3-eth-abi'

import HashcashDifficulty from '../build/contracts/HashcashDifficulty.json'
import ITrustedForwarder from '../build/contracts/ITrustedForwarder.json'
import IRelayRecipient from '../build/contracts/IRelayRecipient.json'

/**
 * low-level hashcash calculation for the given address and nonce
 * This value should be passed as approvalData for the HashcashPaymaster
 * @param senderAddress the address of the sender
 * @param senderNonce the current nonce of the sender
 * @param difficulty target difficulty to meet
 * @param interval call the callback every that many iterations
 * @param callback async callback to call. return "false" to abort. true to continue
 * @return the approvalData value (bytes32 hash, uint256 counter)
 */
export async function calculateHashcash(senderAddress: string, senderNonce: number, difficulty: any, interval?: number, callback?: any) {
    const diffMax = toBN(1).shln(256 - difficulty)
    let hashNonce = 0;
    let intervalCount = 0
    while (true) {
        // @ts-ignore
        const params = abi.encodeParameters(['address', 'uint256', 'uint256'],
            [senderAddress, senderNonce, hashNonce])
        let hash = keccak256(params);
        let val = toBN(hash);
        if (val.lt(diffMax)) {
            if (callback) {
                await callback(difficulty)  //signal "done"
            }
            // @ts-ignore
            return abi.encodeParameters(['bytes32', 'uint256'],
                [hash, hashNonce])
        }
        hashNonce++
        if (interval && intervalCount++ > interval) {
            intervalCount = 0
            if (!await callback(difficulty, hashNonce))
                return null
        }
    }
}

/**
 * RelayProvider Helper: use to initialize
 * the asyncApprovalData, when using HashcashProvider.
 * NOTE: this will cause the method call to block until the calculation is finished.
 * @param difficulty level this hashcash instance requires. make sure this value is
 *  the same (or higher) as the provider requires, otherwise, you'll get a revert of
 *  "difficulty not met"
 *  @param interval call the callback function every that many iterations
 *  @param callback async callback to call. return false to abort calculation
 * @returns - an async function to pass as a parameter for "asyncApprovalData" of the
 *  RelayProvider. see the HashcashPaymaster.test.ts for usage example.
 */
export function createHashcashAsyncApproval(difficulty: any, interval?: number, callback?: any): (relayRequest: RelayRequest) => Promise<string> {

    return async function (relayRequest: RelayRequest): Promise<string> {
        console.log('=== calculating approval')
        const {senderAddress, senderNonce} = relayRequest.relayData
        const val = calculateHashcash(senderAddress, senderNonce, difficulty, interval, callback)
        console.log('=== done calculating approval')
        return val
    }
}

//helper: call the "call()" method, and throw the given string in case of error
// (most likely - object doens't support this method..)
async function checkedCall(method: any, str: string) {
    try {
        return await method.call()
    } catch (e) {
        console.log('==e', e)
        throw new Error(str + ': ' + e)
    }
}

/**
 * calculate in advance async approval.
 * @param web3
 * @param senderAddr
 * @param recipientAddr the recipient address to use
 * @param forwarderAddress
 * @param hashcashPaymasterAddr the hashcash paymaster to work with
 * @param interval
 * @param callback
 */
export async function calculateHashcashApproval(web3: Web3, senderAddr: string, recipientAddr: string, forwarderAddress: string, hashcashPaymasterAddr?: string, interval?: number, callback?: any) {
    // @ts-ignore
    const paymaster = new web3.eth.Contract(HashcashDifficulty.abi, hashcashPaymasterAddr).methods
    const difficulty = await checkedCall(paymaster.difficulty(), hashcashPaymasterAddr + ': not A HashcashPaymaster')
    // @ts-ignore
    const recipient = new web3.eth.Contract(IRelayRecipient.abi, recipientAddr).methods
    // @ts-ignore
    const forwarder = new web3.eth.Contract(ITrustedForwarder.abi, forwarderAddress).methods
    const nonce = await checkedCall(forwarder.getNonce(senderAddr), 'No getNonce()')

    console.log('calling with addr=', senderAddr, 'nonce=', nonce, 'fwd=', forwarderAddress, 'recipient=', recipientAddr)
    return calculateHashcash(senderAddr, nonce, difficulty, interval, callback)
}
