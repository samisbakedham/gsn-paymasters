//SPDX-License-Identifier: MIT
pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

import "./VerifyingPaymaster.sol";

contract VerifyingTransferPaymaster is VerifyingPaymaster {

    // Note: this paymaster does not send all incoming funds to the RelayHub
    // solhint-disable-next-line no-empty-blocks
    receive () external override payable {}

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    public
    override
    virtual
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (context, revertOnRecipientRevert) = super.preRelayedCall(relayRequest, signature, approvalData, maxPossibleGas);
        payable(relayRequest.relayData.forwarder).transfer(relayRequest.request.value);
    }
}
