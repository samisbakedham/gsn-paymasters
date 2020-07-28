// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/interfaces/GsnTypes.sol";
import "@opengsn/gsn/contracts/interfaces/IPaymaster.sol";

/**
 * This mock relay hub contract is only used to test the paymaster's 'postRelayedCall' in isolation.
 */
contract TestHub {
    function callPostRC(
        IPaymaster paymaster,
        bytes calldata context,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external {
        paymaster.postRelayedCall(context, true, gasUseWithoutPost, relayData);
    }

    event Deposited(
        address indexed paymaster,
        address indexed from,
        uint256 amount
    );

    function depositFor(address target) public payable {
        emit Deposited(target, msg.sender, msg.value);
    }
}
