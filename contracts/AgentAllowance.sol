// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal USDC interface (Arc's native USDC exposes a standard ERC-20 interface).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title AgentAllowance
/// @notice An on-chain spending allowance for AI agents on Arc.
///         The owner funds the contract with USDC and grants each agent a hard
///         spending cap. An agent can pay anyone up to its cap — the limit is
///         enforced in this contract and the transaction REVERTS if exceeded.
///         The owner can revoke an agent or withdraw funds at any time.
///
/// @dev    Amounts are in USDC base units (6 decimals): 1 USDC == 1_000_000.
///         The cap is a lifetime total per agent: an agent may spend up to `cap`
///         in aggregate. Raising the cap grants more headroom; it does not reset
///         what has already been spent.
contract AgentAllowance {
    struct Allowance {
        uint256 cap;    // lifetime spending cap for this agent
        uint256 spent;  // total spent so far
        bool active;    // whether the agent may currently spend
    }

    IERC20 public immutable usdc;
    address public owner;
    mapping(address => Allowance) private _allowances;

    uint256 private _locked = 1; // reentrancy guard

    event OwnershipTransferred(address indexed from, address indexed to);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AgentAuthorized(address indexed agent, uint256 cap);
    event AgentRevoked(address indexed agent);
    event Paid(address indexed agent, address indexed to, uint256 amount, string memo);

    error NotOwner();
    error NotActiveAgent();
    error ZeroAddress();
    error ZeroAmount();
    error CapExceeded(uint256 requested, uint256 remaining);
    error InsufficientTreasury(uint256 requested, uint256 available);
    error TransferFailed();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IERC20 _usdc) {
        if (address(_usdc) == address(0)) revert ZeroAddress();
        usdc = _usdc;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ---------------------------------------------------------------- owner ---

    /// @notice Pull `amount` USDC from the owner into the contract treasury.
    /// @dev    Requires the owner to have approved this contract for `amount`.
    ///         (USDC can also be sent to this contract directly via transfer.)
    function deposit(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        _safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Return `amount` USDC from the treasury back to the owner.
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = usdc.balanceOf(address(this));
        if (amount > bal) revert InsufficientTreasury(amount, bal);
        _safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    /// @notice Grant or update an agent's spending cap and activate it.
    /// @dev    Does not reset `spent`; raising the cap grants more headroom.
    function authorizeAgent(address agent, uint256 cap) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        Allowance storage a = _allowances[agent];
        a.cap = cap;
        a.active = true;
        emit AgentAuthorized(agent, cap);
    }

    /// @notice Immediately revoke an agent's ability to spend.
    function revokeAgent(address agent) external onlyOwner {
        _allowances[agent].active = false;
        emit AgentRevoked(agent);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------------------------------------------------------------- agent ---

    /// @notice Pay `amount` USDC to `to`, attaching an on-chain `memo`.
    ///         Callable by an active agent; reverts if it would exceed the cap
    ///         or if the treasury is short. The cap check happens BEFORE funds move.
    function spend(address to, uint256 amount, string calldata memo) external nonReentrant {
        Allowance storage a = _allowances[msg.sender];
        if (!a.active) revert NotActiveAgent();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 left = a.cap > a.spent ? a.cap - a.spent : 0;
        if (amount > left) revert CapExceeded(amount, left);

        uint256 bal = usdc.balanceOf(address(this));
        if (amount > bal) revert InsufficientTreasury(amount, bal);

        // effects before interaction
        a.spent += amount;

        _safeTransfer(to, amount);
        emit Paid(msg.sender, to, amount, memo);
    }

    // ----------------------------------------------------------------- views ---

    function treasury() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function allowanceOf(address agent) external view returns (uint256 cap, uint256 spent, bool active) {
        Allowance storage a = _allowances[agent];
        return (a.cap, a.spent, a.active);
    }

    /// @notice USDC the agent can still spend (0 if inactive or cap reached).
    function remaining(address agent) external view returns (uint256) {
        Allowance storage a = _allowances[agent];
        if (!a.active || a.spent >= a.cap) return 0;
        return a.cap - a.spent;
    }

    // -------------------------------------------------------------- internal ---

    function _safeTransfer(address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdc).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = address(usdc).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
