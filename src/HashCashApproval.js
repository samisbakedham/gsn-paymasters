const {keccak256, toBN} = require('web3-utils')
const RelayRequest = require("@opengsn/gsn/dist/src/common/EIP712/RelayRequest");
const abi = require('web3-eth-abi')

const HashcashDifficulty = require('../build/contracts/HashCashDifficulty')
const ITrustedForwarder = require('../build/contracts/ITrustedForwarder')
const IRelayRecipient = require('../build/contracts/IRelayRecipient')

/**
 * low-level hashcash calculation for the given address and nonce
 * This value should be passed as approvalData for the HashcashPaymaster
 * @param address the address of the sender
 * @param nonce the current nonce of the sender
 * @param difficulty target difficulty to meet
 * @param interval call the callback every that many iterations
 * @param callback async callback to call. return "false" to abort. true to continue
 * @return the approvalData value (bytes32 hash, uint256 counter)
 */
async function calculateHashcash(senderAddress, senderNonce, difficulty, interval, callback) {
    const diffMax = toBN(1).shln(256 - difficulty)
    let hashNonce = 0;
    let intervalCount = 0
    while (true) {
        const params = abi.encodeParameters(['address', 'uint256', 'uint256'],
            [senderAddress, senderNonce, hashNonce])
        let hash = keccak256(params);
        let val = toBN(hash);
        if (val.lt(diffMax)) {
            if (callback) {
                await callback(difficulty)  //signal "done"
            }
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
 * @param The difficulty level this hashcash instance requires. make sure this value is
 *  the same (or higher) as the provider requires, otherwise, you'll get a revert of
 *  "difficulty not met"
 *  @param interval call the callback function every that many iterations
 *  @param callback async callback to call. return false to abort calculation
 * @returns - an async function to pass as a parameter for "asyncApprovalData" of the
 *  RelayProvider. see the HashcashPaymaster.test.js for usage example.
 */
function createHashcashAsyncApproval(difficulty, interval, callback) {

    return async function (relayRequest) {
        console.log('=== calculating approval')
        const {senderAddress, senderNonce} = relayRequest.relayData
        val = calculateHashcash(senderAddress, senderNonce, difficulty, interval, callback)
        console.log('=== done calculating approval')
        return val
    }
}

//helper: call the "call()" method, and throw the given string in case of error
// (most likely - object doens't support this method..)
async function checkedCall(method, str) {
    try {
        return await method.call()
    } catch (e) {
        console.log( '==e',e)
        throw new Error(str + ': ' + e)
    }
}

/**
 * calculate in advance async approval.
 * @param web3
 * @param recipientAddr the recipient address to use
 * @param hashcahPaymasterAddr the hashcash paymaster to work with
 * @param interval
 * @param callback
 */
async function calculateHashcashApproval(web3, senderAddr, recipientAddr, hashcahPaymasterAddr, interval, callback) {
    const paymaster = new web3.eth.Contract(HashcashDifficulty.abi, hashcahPaymasterAddr).methods
    const difficulty = await checkedCall(paymaster.difficulty(), hashcahPaymasterAddr + ': not A HashcashPaymaster')
    const recipient = new web3.eth.Contract(IRelayRecipient.abi, recipientAddr).methods
    let forwarderAddress = await checkedCall(recipient.getTrustedForwarder(), 'No getForwarder');
    const forwarder = new web3.eth.Contract(ITrustedForwarder.abi, forwarderAddress).methods
    const nonce = await checkedCall(forwarder.getNonce(senderAddr), 'No getNonce()')

    console.log('calling with addr=',senderAddr, 'nonce=',nonce, 'fwd=', forwarderAddress, 'recipient=', recipientAddr)
    return calculateHashcash(senderAddr, nonce, difficulty, interval, callback)
}

module.exports = {
    createHashcashAsyncApproval,
    calculateHashcashApproval,
    calculateHashcash
}
