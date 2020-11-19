//SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Address.sol";
import "./eip1167/CloneFactory.sol";
import "./ProxyIdentity.sol";

contract ProxyFactory is CloneFactory {
    using Address for address;

    address public templateFactory;

    constructor() public {
        templateFactory = address(new ProxyIdentity(bytes3("abc")));
    }

    event ProxyDeployed(address proxyAddress);

    function calculateAddress(address owner, uint salt) external view returns (address) {
        bytes32 _salt = keccak256(abi.encode(owner, salt));
        return getClone2Address(templateFactory, _salt);
    }

    function deployProxy(address owner, uint salt) external returns (ProxyIdentity) {
//        if (!calculatedAddress.isContract()) {
            bytes32 _salt = keccak256(abi.encode(owner, salt));
            ProxyIdentity proxyIdentity = ProxyIdentity(payable(createClone2(templateFactory, _salt)));
            require(address(0) != address(proxyIdentity), "FATAL: failed to create2...");
            proxyIdentity.initOwner(owner);
//            address calculatedAddress = this.calculateAddress(owner, salt);
//            require(calculatedAddress == address(proxyIdentity), "FATAL: create2 returned wrong address...");
            emit ProxyDeployed(address(proxyIdentity));
//        }
        return proxyIdentity;
    }
}
