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
    ) public override virtual view
    returns (bytes memory) {
        GsnEip712Library.verifySignature(relayRequest, signature);
        (IERC20 token, IUniswap uniswap) = _getToken(relayRequest.relayData.paymasterData);
        (address payer, uint256 tokenPreCharge) = _calculatePreCharge(token, uniswap, relayRequest, maxPossibleGas);

        bool isApproved = tokenPreCharge < token.allowance(payer, address(this));
        require(isApproved || !payer.isContract(), "identity deployed but allowance too low");
        return abi.encode(payer, relayRequest.request.from, tokenPreCharge, relayRequest.request.value, relayRequest.relayData.forwarder, token, uniswap);
    }

    function getPayer(GsnTypes.RelayRequest calldata relayRequest) public override virtual view returns (address) {
        // TODO: if (rr.paymasterData != '') return address(rr.paymasterData)
        //  this is to support pre-existing proxies/proxies with changed owner
        return proxyFactory.calculateAddress(relayRequest.request.from);
    }

    function preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    external
    override
    virtual
    returns (bytes memory, bool revertOnRecipientRevert) {
        bytes memory context = acceptRelayedCall(relayRequest, signature, approvalData, maxPossibleGas);
        (
            address payer, address owner, uint256 tokenPrecharge,
            uint256 valueRequested, address payable destination,
            IERC20 token, IUniswap uniswap
        ) = abi.decode(context, (address, address, uint256, uint256, address, IERC20, IUniswap));
        if (!payer.isContract()) {
            deployProxy(owner);
        }
        token.transferFrom(payer, address(this), tokenPrecharge);
        //solhint-disable-next-line
        uniswap.tokenToEthSwapOutput(valueRequested, uint256(-1), block.timestamp+60*15);
        destination.transfer(valueRequested);
        return (context, false);
    }

    function deployProxy(address owner) public returns (ProxyIdentity) {
        ProxyIdentity proxy = proxyFactory.deployProxy(owner);
        proxy.initialize(address(trustedForwarder), tokens);
    }

    function postRelayedCall(
        bytes calldata context,
        bool,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    ) external override virtual {
        (address payer,, uint256 tokenPrecharge, uint256 valueRequested,,IERC20 token, IUniswap uniswap) = abi.decode(context, (address, address, uint256, uint256, address, IERC20, IUniswap));
        _postRelayedCallInternal(payer, tokenPrecharge, valueRequested, gasUseWithoutPost, relayData, token, uniswap);
    }

    // TODO: calculate precise values for these params
    uint256 constant private PRE_RELAYED_CALL_GAS_LIMIT_OVERRIDE = 2000000;

    function getGasLimits()
    public
    override
    view
    returns (
        GasLimits memory limits
    ) {
        return GasLimits(
            PAYMASTER_PAYS_ABOVE,
            PRE_RELAYED_CALL_GAS_LIMIT_OVERRIDE,
            POST_RELAYED_CALL_GAS_LIMIT
        );
    }
}
