pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/BasePaymaster.sol";
import "@opengsn/gsn/contracts/utils/GsnUtils.sol";

// accept everything.
// this paymaster accepts any request.
contract AcceptEverythingPaymaster is BasePaymaster {

    function versionPaymaster() external view override virtual returns (string memory){
        return "2.0.0-alpha.1+opengsn.accepteverything.ipaymaster";
    }

    function acceptRelayedCall(
        GSNTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleCharge
    ) external override virtual view
    returns (bytes memory) {
        (relayRequest, approvalData, maxPossibleCharge);
        return "";
    }

    function preRelayedCall(bytes calldata context) external override virtual
    returns (bytes32) {
        (context);
        return 0;
    }

    function postRelayedCall(
        bytes calldata context,
        bool success,
        bytes32 preRetVal,
        uint256 gasUseWithoutPost,
        GSNTypes.GasData calldata gasData
    ) external override virtual {
        (context, success, preRetVal, gasUseWithoutPost, gasData);
    }

}
