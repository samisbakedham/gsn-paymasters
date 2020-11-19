//SPDX-License-Identifier: MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/utils/Address.sol";
import "./ProxyFactory.sol";
import "./TokenPaymaster.sol";

interface IProxyDeployingPaymaster {
    function calculateAddress(address owner, uint salt) view external returns (address);
}

contract ProxyDeployingPaymaster is TokenPaymaster, IProxyDeployingPaymaster {
    using Address for address;

    function versionPaymaster() public view override returns (string memory) {
        return "2.0.3+opengsn.proxydeploying.ipaymaster";
    }

    ProxyFactory public proxyFactory;

    constructor(IUniswap[] memory _uniswaps, ProxyFactory _proxyFactory) public TokenPaymaster(_uniswaps)  {
        proxyFactory = _proxyFactory;
    }

    function getPayer(GsnTypes.RelayRequest calldata relayRequest) public override virtual view returns (address) {
        // TODO: if (rr.paymasterData != '') return address(rr.paymasterData)
        //  this is to support pre-existing proxies/proxies with changed owner
        //        return proxyFactory.calculateAddress(relayRequest.request.from);
        return relayRequest.request.to;
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
        (relayRequest, signature, approvalData, maxPossibleGas);
        (IERC20 token, IUniswap uniswap) = _getToken(relayRequest.relayData.paymasterData);
        (address payer, uint256 tokenPrecharge) = _calculatePreCharge(uniswap, relayRequest, maxPossibleGas);
        if (!tokenTransferFrom(token, payer, address(this), tokenPrecharge)) {
            require(!payer.isContract(), "unable to pre-charge account");
            //failed to pre-charge. attempt to deploy:
            uint salt = 0;

            //TODO: using high-bits for salt, since TokenPaymaster uses it for token address
            if (relayRequest.relayData.paymasterData.length == 32) {
                salt = abi.decode(relayRequest.relayData.paymasterData, (uint)) >> 160;
            }
            address addr = address(deployProxy(relayRequest.request.from, salt));
            require(addr == relayRequest.request.to, "wrong create2 address");
            require(tokenTransferFrom(token, payer, address(this), tokenPrecharge), "unable to deploy and pre-charge");
        }
        if (relayRequest.request.value != 0) {
            //solhint-disable-next-line
            uniswap.tokenToEthSwapOutput(relayRequest.request.value, uint256(- 1), block.timestamp + 60 * 15);
            payable(relayRequest.relayData.forwarder).transfer(relayRequest.request.value);
        }
        return (abi.encode(payer, relayRequest.request.from, tokenPrecharge, relayRequest.request.value, relayRequest.relayData.forwarder, token, uniswap), false);
    }

    //there are 2 profiles of transferFrom:
    // return true/false on success/failure
    // no return value, and revert on failure.
    // this method accept both:
    //  - revert returns "false"
    //  - if return value length is nonzero, this it is assumed to be boolean.
    //  - zero-length return value is assumed to be "true"
    function tokenTransferFrom(IERC20 token, address from, address to, uint value) private returns(bool) {
        // solhint-disable avoid-low-level-calls
        (bool success, bytes memory ret) = address(token).call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        if (success) {
            success = ret.length==0 || abi.decode(ret, (bool));
        }
        return success;
    }

    function deployProxy(address owner, uint salt) public returns (ProxyIdentity) {
        ProxyIdentity proxy = proxyFactory.deployProxy(owner, salt);
        require(this.calculateAddress(owner, salt) == address (proxy), "FATAL: wrong create2 address");
        proxy.initialize(address(trustedForwarder), tokens);
        return proxy;
    }

    function calculateAddress(address owner, uint salt) view override external returns (address) {
        return proxyFactory.calculateAddress(owner, salt);
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
            PAYMASTER_ACCEPTANCE_BUDGET,
            PRE_RELAYED_CALL_GAS_LIMIT_OVERRIDE,
            POST_RELAYED_CALL_GAS_LIMIT
        );
    }
}
