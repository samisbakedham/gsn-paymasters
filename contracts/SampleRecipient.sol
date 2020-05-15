pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@opengsn/gsn/contracts/BaseRelayRecipient.sol";

// pass-through paymaster.
// should override it and re-implement acceptRelayedCall. use "super" on success
contract SampleRecipient is BaseRelayRecipient {

    event Sender( address _msgSenderFunc, address sender );

    function setForwarder(address forwarder) public {
        trustedForwarder = forwarder;
    }
    function something() public {
        emit Sender( _msgSender(), msg.sender );
    }
}
