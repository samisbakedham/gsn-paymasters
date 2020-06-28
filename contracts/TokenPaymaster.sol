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


    IUniswap[] public uniswaps;
    IERC20[] public tokens;

    mapping (IUniswap=>bool ) private supportedUniswaps;

    uint public gasUsedByPost;

    constructor(IUniswap[] memory _uniswaps) public {
        uniswaps = _uniswaps;

        for (uint256 i = 0; i < _uniswaps.length; i++){
            supportedUniswaps[_uniswaps[i]] = true;
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
    function getPayer(GsnTypes.RelayRequest calldata relayRequest) public virtual view returns (address) {
        (this);
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

        (IERC20 token, IUniswap uniswap) = _getToken(relayRequest.relayData.paymasterData);

        (address payer, uint256 tokenPreCharge) = _calculatePreCharge(token, uniswap, relayRequest, maxPossibleGas);

        require(tokenPreCharge < token.allowance(payer, address(this)), "allowance too low");
        return abi.encode(payer, tokenPreCharge, token, uniswap);
    }

    function _getToken(bytes memory paymasterData) internal view returns (IERC20 token, IUniswap uniswap) {
        //if no specific token specified, assume the first in the list.
        if ( paymasterData.length==0 ) {
            return (tokens[0], uniswaps[0]);
        }

        require(paymasterData.length==32, "invalid uniswap address in paymasterData");
        uniswap = abi.decode(paymasterData, (IUniswap));
        require(supportedUniswaps[uniswap], "unsupported token uniswap");
        token = IERC20(uniswap.tokenAddress());
    }

    function _calculatePreCharge(
        IERC20 token,
        IUniswap uniswap,
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
        (address payer, uint tokenPrecharge, IERC20 token) = abi.decode(context, (address, uint, IERC20));
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
        (address payer, uint256 tokenPrecharge, IERC20 token, IUniswap uniswap) = abi.decode(context, (address, uint256, IERC20, IUniswap));
        _postRelayedCallInternal(payer, tokenPrecharge, gasUseWithoutPost, relayData, token, uniswap);
    }

    function _postRelayedCallInternal(
        address payer,
        uint256 tokenPrecharge,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData,
        IERC20 token,
        IUniswap uniswap
    ) internal {
        uint256 ethActualCharge = relayHub.calculateCharge(gasUseWithoutPost.add(gasUsedByPost), relayData);
        uint256 tokenActualCharge = uniswap.getTokenToEthOutputPrice(ethActualCharge);
        uint256 tokenRefund = tokenPrecharge.sub(tokenActualCharge);
        _refundPayer(payer, token, tokenRefund);
        _depositProceedsToHub(ethActualCharge, uniswap);
        emit TokensCharged(gasUseWithoutPost, gasUsedByPost, ethActualCharge, tokenActualCharge);
    }

    function _refundPayer(
        address payer,
        IERC20 token,
        uint256 tokenRefund
    ) private {
        require(token.transfer(payer, tokenRefund), "failed refund");
    }

    function _depositProceedsToHub(uint256 ethActualCharge, IUniswap uniswap) private {
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
