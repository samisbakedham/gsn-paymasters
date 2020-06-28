//SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Address.sol";
import "./ProxyFactory.sol";
import "./TokenPaymaster.sol";

contract ProxyDeployingPaymaster is TokenPaymaster {
    using Address for address;

    string public override versionPaymaster = "2.0.0-alpha.1+opengsn.proxydeploying.ipaymaster";

    ProxyFactory public proxyFactory;

    constructor(IUniswap[] memory _uniswaps, ProxyFactory _proxyFactory) public TokenPaymaster(_uniswaps)  {
        proxyFactory = _proxyFactory;
    }

    function acceptRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata,
        uint256 maxPossibleGas
    ) external override virtual view
    returns (bytes memory) {
        GsnEip712Library.verifySignature(relayRequest, signature);
        (IERC20 token, IUniswap uniswap) = _getToken(relayRequest.relayData.paymasterData);
        (address payer, uint256 tokenPreCharge) = _calculatePreCharge(token, uniswap, relayRequest, maxPossibleGas);

        bool isApproved = tokenPreCharge < token.allowance(payer, address(this));
        require(isApproved || !payer.isContract(), "identity deployed but allowance too low");
        return abi.encode(payer, relayRequest.request.from, tokenPreCharge, token, uniswap);
    }

    function getPayer(GsnTypes.RelayRequest calldata relayRequest) public override virtual view returns (address) {
        // TODO: if (rr.paymasterData != '') return address(rr.paymasterData)
        //  this is to support pre-existing proxies/proxies with changed owner
        return proxyFactory.calculateAddress(relayRequest.request.from);
    }

    function preRelayedCall(bytes calldata context) external override virtual
    returns (bytes32) {
        (address payer, address owner, uint256 tokenPrecharge, IERC20 token) = abi.decode(context, (address, address, uint256, IERC20));
        if (!payer.isContract()) {
            deployProxy(owner);
        }
        token.transferFrom(payer, address(this), tokenPrecharge);
        return 0;
    }

    function deployProxy(address owner) public returns (ProxyIdentity) {
        ProxyIdentity proxy = proxyFactory.deployProxy(owner);
        proxy.initialize(address(trustedForwarder), tokens);
    }

    function postRelayedCall(
        bytes calldata context,
        bool,
        bytes32,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external override virtual {
        (address payer,, uint tokenPrecharge, IERC20 token, IUniswap uniswap) = abi.decode(context, (address, address, uint, IERC20, IUniswap));
        _postRelayedCallInternal(payer, tokenPrecharge, gasUseWithoutPost, relayData, token, uniswap);
    }

    // TODO: calculate precise values for these params
    uint256 constant private ACCEPT_RELAYED_CALL_GAS_LIMIT = 120000;
    uint256 constant private PRE_RELAYED_CALL_GAS_LIMIT = 2000000;
    uint256 constant private POST_RELAYED_CALL_GAS_LIMIT = 110000;

    function getGasLimits()
    external
    override
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
