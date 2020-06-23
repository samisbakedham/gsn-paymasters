// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@opengsn/gsn/contracts/RelayHub.sol";

import "../TokenPaymaster.sol";


/**
 * Calculate the postRelayedCall gas usage for a TokenPaymaster.
 *
 */
contract TokenGasCalculator is RelayHub {

    //(The Paymaster calls back calculateCharge, deposotFor in the relayHub,
    //so the calculator has to implement them just like a real RelayHub
    // solhint-disable-next-line no-empty-blocks
    constructor(StakeManager _stakeManager, Penalizer _penalizer) public RelayHub(_stakeManager, _penalizer) {}

    /**
     * calculate actual cost of postRelayedCall.
     * usage:
     * - create this calculator.
     * - create an instance of your TokenPaymaster, with your token's Uniswap instance.
     * - move some tokens (1000 "wei") to the calculator (msg.sender is given approval to pull them back at the end)
     * - set the calculator as owner of this calculator.
     * - call this method.
     * - use the returned values to set your real TokenPaymaster.setPostGasUsage()
     * the above can be ran on a "forked" network, so that it will have the real token, uniswap instances,
     * but still leave no side-effect on the network.
     */
    function calculatePostGas(TokenPaymaster paymaster) public returns (uint gasUsedByPost) {
        address paymasterAddress = address(paymaster);
        IERC20 token = paymaster.token();
        require(token.balanceOf(address(this)) >= 1000, "must move some tokens to calculator first");
        require(paymaster.owner() == address(this), "must set calculator as owner of paymaster");
        token.approve(paymasterAddress, uint(-1));
        token.approve(msg.sender, uint(-1));
        // emulate a "precharge"
        token.transfer(paymasterAddress, 500);

        paymaster.setRelayHub(IRelayHub(address(this)));

        GsnTypes.RelayData memory relayData = GsnTypes.RelayData(1, 0, 0, address(0), address(0), address(0));
        bytes memory ctx1 = abi.encode(this, uint(500));
        //with precharge
        uint gas0 = gasleft();
        paymaster.postRelayedCall(ctx1, true, bytes32(0), 100, relayData);
        uint gas1 = gasleft();

        token.transferFrom(paymasterAddress, address(this), token.balanceOf(paymasterAddress));
        gasUsedByPost = gas0 - gas1;
        emit GasUsed(gasUsedByPost);
    }

    event GasUsed(uint gasUsedByPost);
}

