pragma solidity ^0.6.9;

contract TestCounter {
    uint public count;

    constructor () public {
        count = 0;
    }

    function increment() public payable{
        count = count + 1;
    }

    function get() public view returns (uint) {
        return count;
    }

    fallback() external payable {}
}
