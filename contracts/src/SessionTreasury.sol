// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CCIP, IRouterClient} from "./interfaces/CCIP.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @notice USDC treasury for one chain. Pays on its home chain directly, or on another mainnet via CCIP 2.0.
contract SessionTreasury {
    error NotOwner();
    error BadRecipient();
    error BadAmount();
    error LaneMissing();
    error ExtraArgsRequired();
    error FeeShort();
    error TransferFailed();

    /// @dev CCIP chain selector for Base mainnet.
    uint64 public constant BASE_SELECTOR = 15_971_525_489_660_198_786;

    IRouterClient public immutable router;
    address public immutable usdc;
    uint64 public immutable homeSelector;
    address public owner;

    mapping(uint64 destChainSelector => bool allowed) public lane;

    event LaneSet(uint64 indexed destChainSelector, bool allowed);
    event RewardSent(bytes32 indexed messageId, uint64 indexed destChainSelector, address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param homeSelector_ CCIP selector of the chain this treasury is deployed on.
    /// @param lanes_ Selectors this treasury may CCIP to. The home chain is always a direct transfer.
    constructor(address router_, address usdc_, uint64 homeSelector_, uint64[] memory lanes_) {
        owner = msg.sender;
        router = IRouterClient(router_);
        usdc = usdc_;
        homeSelector = homeSelector_;
        for (uint256 i = 0; i < lanes_.length; i++) {
            if (lanes_[i] == homeSelector_) revert LaneMissing();
            lane[lanes_[i]] = true;
            emit LaneSet(lanes_[i], true);
        }
    }

    function setLane(uint64 destChainSelector, bool allowed) external onlyOwner {
        if (destChainSelector == homeSelector) revert LaneMissing();
        lane[destChainSelector] = allowed;
        emit LaneSet(destChainSelector, allowed);
    }

    function quote(uint64 destChainSelector, address recipient, uint256 amount, bytes calldata extraArgs)
        external
        view
        returns (uint256 fee)
    {
        if (destChainSelector == homeSelector) return 0;
        return router.getFee(destChainSelector, _message(recipient, amount, extraArgs));
    }

    /// @notice Pay `amount` of USDC (6 decimals) to `recipient`.
    /// On the home chain, transfer directly. Elsewhere, CCIP the tokens to that wallet.
    /// `extraArgs` is built off-chain (CCIP 2.0 ExtraArgsV3) so the encoding can change without a redeploy.
    function sendReward(uint64 destChainSelector, address recipient, uint256 amount, bytes calldata extraArgs)
        external
        payable
        onlyOwner
        returns (bytes32 messageId)
    {
        if (recipient == address(0)) revert BadRecipient();
        if (amount == 0) revert BadAmount();

        if (destChainSelector == homeSelector) {
            _callToken(usdc, abi.encodeWithSelector(IERC20.transfer.selector, recipient, amount));
            emit RewardSent(bytes32(0), destChainSelector, recipient, amount);
            return bytes32(0);
        }

        if (!lane[destChainSelector]) revert LaneMissing();
        if (extraArgs.length == 0) revert ExtraArgsRequired();

        _callToken(usdc, abi.encodeWithSelector(IERC20.approve.selector, address(router), 0));
        _callToken(usdc, abi.encodeWithSelector(IERC20.approve.selector, address(router), amount));

        CCIP.EVM2AnyMessage memory message = _message(recipient, amount, extraArgs);
        uint256 fee = router.getFee(destChainSelector, message);
        if (msg.value < fee) revert FeeShort();

        messageId = router.ccipSend{value: fee}(destChainSelector, message);
        if (msg.value > fee) {
            (bool refunded,) = owner.call{value: msg.value - fee}("");
            require(refunded, "refund");
        }
        emit RewardSent(messageId, destChainSelector, recipient, amount);
    }

    function _message(address recipient, uint256 amount, bytes calldata extraArgs)
        internal
        view
        returns (CCIP.EVM2AnyMessage memory message)
    {
        CCIP.EVMTokenAmount[] memory tokens = new CCIP.EVMTokenAmount[](1);
        tokens[0] = CCIP.EVMTokenAmount({token: usdc, amount: amount});
        message = CCIP.EVM2AnyMessage({
            receiver: abi.encode(recipient),
            data: "",
            tokenAmounts: tokens,
            extraArgs: extraArgs,
            feeToken: address(0)
        });
    }

    function _callToken(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    receive() external payable {}
}
