//SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/BaseRelayRecipient.sol";

// pass-through paymaster.
// should override it and re-implement acceptRelayedCall. use "super" on success
contract SampleRecipient is BaseRelayRecipient {
    string public override versionRecipient = "2.0.0+opengsn.sample.irelayrecipient";

    event Sender( address _msgSenderFunc, address sender );

    function setForwarder(address forwarder) public {
        trustedForwarder = forwarder;
    }
    function something() public {
        emit Sender( _msgSender(), msg.sender );
    }
}
