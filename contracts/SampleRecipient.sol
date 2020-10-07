//SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/BaseRelayRecipient.sol";

// pass-through paymaster.
// should override it and re-implement acceptRelayedCall. use "super" on success
contract SampleRecipient is BaseRelayRecipient {
    string public override versionRecipient = "2.0.0-beta.1+opengsn.sample.irelayrecipient";

    event Sender(address _msgSenderFunc, address sender);
    event ReceivedValue(address _msgSenderFunc, address sender, uint256 value);

    function setForwarder(address forwarder) public {
        trustedForwarder = forwarder;
    }
    function something() public {
        emit Sender( _msgSender(), msg.sender );
    }
    function somethingPayable() public payable{
        emit ReceivedValue( _msgSender(), msg.sender, msg.value);
    }
}
