// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/interfaces/GsnTypes.sol";
import "@opengsn/gsn/contracts/interfaces/IPaymaster.sol";

import "@opengsn/gsn/contracts/RelayHub.sol";

/**
 * This mock relay hub contract is only used to test the paymaster's 'pre-' and 'postRelayedCall' in isolation.
 */
contract TestHub is RelayHub {

    // solhint-disable-next-line no-empty-blocks
    constructor(
        IStakeManager _stakeManager,
        address _penalizer,
        uint256 _maxWorkerCount,
        uint256 _gasReserve,
        uint256 _postOverhead,
        uint256 _gasOverhead,
        uint256 _maximumRecipientDeposit,
        uint256 _minimumUnstakeDelay,
        uint256 _minimumStake) public RelayHub(_stakeManager,
        _penalizer,
        _maxWorkerCount,
        _gasReserve,
        _postOverhead,
        _gasOverhead,
        _maximumRecipientDeposit,
        _minimumUnstakeDelay,
        _minimumStake) {}

    function callPreRC(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    returns (bytes memory context, bool revertOnRecipientRevert) {
        return IPaymaster(relayRequest.relayData.paymaster).preRelayedCall(relayRequest, signature, approvalData, maxPossibleGas);
    }

    function callPostRC(
        IPaymaster paymaster,
        bytes calldata context,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external {
        paymaster.postRelayedCall(context, true, gasUseWithoutPost, relayData);
    }
}
