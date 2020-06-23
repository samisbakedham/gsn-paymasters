// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "@opengsn/gsn/contracts/forwarder/IForwarder.sol";
import "@opengsn/gsn/contracts/BasePaymaster.sol";

import "./interfaces/IUniswap.sol";

/**
 * A Token-based paymaster.
 * - each request is paid for by the caller.
 * - acceptRelayedCall - verify the caller can pay for the request in tokens.
 * - preRelayedCall - pre-pay the maximum possible price for the tx
 * - postRelayedCall - refund the caller for the unused gas
 */
contract TokenPaymaster is BasePaymaster {
    using SafeMath for uint256;

    function versionPaymaster() external override virtual view returns (string memory){
        return "2.0.0-alpha.1+opengsn.token.ipaymaster";
    }

    IUniswap public uniswap;
    IERC20 public token;

    IUniswap[] public uniswaps;
    IERC20[] public tokens;

    uint public gasUsedByPost;

    constructor(IUniswap[] memory _uniswaps) public {
        uniswaps = _uniswaps;

        uniswap = _uniswaps[0];
        token = IERC20(_uniswaps[0].tokenAddress());
        token.approve(address(uniswap), uint(-1));

        for (uint256 i = 0; i < _uniswaps.length; i++){
            tokens.push(IERC20(_uniswaps[i].tokenAddress()));
            tokens[i].approve(address(_uniswaps[i]), uint(-1));
        }
    }

    /**
     * set gas used by postRelayedCall, for proper gas calculation.
     * You can use TokenGasCalculator to calculate these values (they depend on actual code of postRelayedCall,
     * but also the gas usage of the token and of Uniswap)
     */
    function setPostGasUsage(uint _gasUsedByPost) external onlyOwner {
        gasUsedByPost = _gasUsedByPost;
    }

    // return the payer of this request.
    // for account-based target, this is the target account.
    function getPayer(GsnTypes.RelayRequest calldata relayRequest) external virtual view returns (address) {
        return relayRequest.request.to;
    }

    event Received(uint eth);
    receive() external override payable {
        emit Received(msg.value);
    }

    /**
     * verify that payer can pay for the transaction: must have balance, and also allownce for
     * this paymaster to use it.
     * NOTE: A sub-class can also allow transactions that can't be pre-paid, e.g. create transaction or
     *  a proxy call to token.approve.
     *  In this case, sub-class the acceptRelayedCall to verify the transaction, and set a tokenPreCharge to zero.
     *  The methods preRelayedCall, postRelayedCall already handle such zero tokenPreCharge.
     */
    function acceptRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    view
    returns (bytes memory context) {
        (approvalData);
        _verifySignature(relayRequest, signature);
        (address payer, uint256 tokenPreCharge) = _calculatePreCharge(relayRequest, maxPossibleGas);

        require(tokenPreCharge < token.allowance(payer, address(this)), "allowance too low");
        return abi.encode(payer, tokenPreCharge);
    }

    function _calculatePreCharge(
        GsnTypes.RelayRequest calldata relayRequest,
        uint256 maxPossibleGas)
    internal
    view
    returns (address payer, uint256 tokenPreCharge) {
        payer = this.getPayer(relayRequest);
        uint ethMaxCharge = relayHub.calculateCharge(maxPossibleGas, relayRequest.relayData);
        tokenPreCharge = uniswap.getTokenToEthOutputPrice(ethMaxCharge);
        require(tokenPreCharge <= token.balanceOf(payer), "balance too low");
    }

    function preRelayedCall(bytes calldata context)
    external
    override
    virtual
    relayHubOnly
    returns (bytes32) {
        (address payer, uint tokenPrecharge) = abi.decode(context, (address, uint));
        token.transferFrom(payer, address(this), tokenPrecharge);
        return bytes32(0);
    }

    function postRelayedCall(
        bytes calldata context,
        bool,
        bytes32,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    external
    override
    virtual
    relayHubOnly {
        (address payer, uint256 tokenPrecharge) = abi.decode(context, (address, uint));
        _postRelayedCallInternal(payer, tokenPrecharge, gasUseWithoutPost, relayData);
    }

    function _postRelayedCallInternal(
        address payer,
        uint256 tokenPrecharge,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) internal {
        uint256 ethActualCharge = relayHub.calculateCharge(gasUseWithoutPost.add(gasUsedByPost), relayData);
        uint256 tokenActualCharge = uniswap.getTokenToEthOutputPrice(ethActualCharge);
        uint256 tokenRefund = tokenPrecharge.sub(tokenActualCharge);
        _refundPayer(payer, tokenRefund);
        _depositProceedsToHub(ethActualCharge);
        emit TokensCharged(gasUseWithoutPost, gasUsedByPost, ethActualCharge, tokenActualCharge);
    }

    function _refundPayer(
        address payer,
        uint256 tokenRefund
    ) private {
        require(token.transfer(payer, tokenRefund), "failed refund");
    }

    function _depositProceedsToHub(uint256 ethActualCharge) private {
        //solhint-disable-next-line
        uniswap.tokenToEthSwapOutput(ethActualCharge, uint(-1), block.timestamp+60*15);
        relayHub.depositFor{value:ethActualCharge}(address(this));
    }

    event TokensCharged(uint gasUseWithoutPost, uint gasJustPost, uint ethActualCharge, uint tokenActualCharge);

    uint256 constant private ACCEPT_RELAYED_CALL_GAS_LIMIT = 120000;
    uint256 constant private PRE_RELAYED_CALL_GAS_LIMIT = 100000;
    uint256 constant private POST_RELAYED_CALL_GAS_LIMIT = 110000;

    function getGasLimits()
    external
    override
    virtual
    view
    returns (
        IPaymaster.GasLimits memory limits
    ) {
        return IPaymaster.GasLimits(
            ACCEPT_RELAYED_CALL_GAS_LIMIT,
            PRE_RELAYED_CALL_GAS_LIMIT,
            POST_RELAYED_CALL_GAS_LIMIT
        );
    }
}
