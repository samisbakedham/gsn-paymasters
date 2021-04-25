//SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import "./AcceptEverythingPaymaster.sol";

interface HashcashDifficulty {
    function difficulty() external returns (uint8);
}


///A paymaster that requires some calculation from the client before accepting a request.
///This comes to prevent attack by anonymous clients.
/// Usage:
/// - Create an instance of the HashcashPaymaster, and give it a proper difficulty level.
/// - When creating a RelayProvider, make sure to use the createHashcashAsyncApproval() with
///   the same difficulty level.
///
/// The "difficulty" level is the number of zero bits at the generated hash.
/// a value of 15 requires roughly 32000 iterations and take ~0.5 second on a normal PC
contract HashcashPaymaster is AcceptEverythingPaymaster, HashcashDifficulty {

    function versionPaymaster() external view override virtual returns (string memory){
        return "2.2.0+opengsn.hashcash.ipaymaster";
    }

    uint8 public override difficulty;
    constructor(uint8 _difficulty) {
        difficulty = _difficulty;
    }

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    relayHubOnly
    returns (bytes memory, bool revertOnRecipientRevert) {

        (relayRequest, approvalData, maxPossibleGas, signature);

        require(approvalData.length == 64, "no hash in approvalData");
        (bytes32 hash, uint256 hashNonce) = abi.decode(approvalData, (bytes32, uint256));
        bytes32 calcHash = keccak256(abi.encode(
                relayRequest.request.from,
                relayRequest.request.nonce,
                hashNonce));
        require(hash == calcHash, "wrong hash");
        require(uint256(hash) < (uint256(1) << (256 - difficulty)), "difficulty not met");
        return ("", false);
    }
}
