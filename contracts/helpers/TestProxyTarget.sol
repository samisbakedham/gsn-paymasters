// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;

import "@openzeppelin/contracts/access/Ownable.sol";

contract TestProxyTarget is Ownable  {

    event Test(address msgSender);
    //not a proxy method; just for testing.
    function test() public {
        emit Test(msg.sender);
    }
}
