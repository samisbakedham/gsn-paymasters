const {keccak256, toBN} = require('web3-utils')
const RelayRequest = require("@opengsn/gsn/dist/src/common/EIP712/RelayRequest");
const abi = require('web3-eth-abi')

/**
 * This function calculates the approvalData required by the HashCashPaymaster.
 * @param The difficulty level this hashcash instance requires. make sure this value is
 *  the same (or higher) as the provider requires, otherwise, you'll get a revert of
 *  "difficulty not met"
 * @returns - an async function to pass as a parameter for "asyncApprovalData" of the
 *  RelayProvider. see the HashcashPaymaster.test.js for usage example.
 */
function createHashcashAsyncApproval(difficulty) {

    return async function (relayRequest) {
        const diffMax = toBN(1).shln(256 - difficulty)
        console.log('=== calculating approval')
        const {senderAddress, senderNonce} = relayRequest.relayData
        let hashNonce = 0;
        while (true) {
            const params = abi.encodeParameters(['address', 'uint256', 'uint256'], [senderAddress, senderNonce, hashNonce])
            let hash = keccak256(params);
            let val = toBN(hash);
            if (val.lt(diffMax)) {
                console.log('=== done calculating approval hashNonce=', hashNonce)
                return abi.encodeParameters(['bytes32', 'uint256'], [hash, hashNonce])
            }
            hashNonce++
        }
    }
}

module.exports = {createHashcashAsyncApproval}
