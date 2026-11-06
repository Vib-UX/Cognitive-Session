// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ENSv2-style subname registry for Session demo names.
/// @dev Models a permissioned resolver: the subname owner alone edits addr/text.
contract SessionNameRegistry {
    error NameTaken();
    error NotOwner();
    error BadLabel();

    bytes32 public immutable parentNode;
    string public parentName;

    mapping(bytes32 node => address owner) public owners;
    mapping(bytes32 node => address) private _addr;
    mapping(bytes32 node => mapping(string key => string value)) private _text;

    event NameRegistered(string label, bytes32 indexed node, address indexed owner);
    event AddressChanged(bytes32 indexed node, address a);
    event TextChanged(bytes32 indexed node, string key, string value);

    constructor(string memory parentName_) {
        parentName = parentName_;
        parentNode = namehash(parentName_);
    }

    function register(string calldata label, address owner_, string calldata host)
        external
        returns (bytes32 node)
    {
        if (bytes(label).length == 0) revert BadLabel();
        node = namehash(string.concat(label, ".", parentName));
        if (owners[node] != address(0)) revert NameTaken();
        owners[node] = owner_;
        _addr[node] = owner_;
        _text[node]["host"] = host;
        emit NameRegistered(label, node, owner_);
        emit AddressChanged(node, owner_);
        emit TextChanged(node, "host", host);
    }

    function setAddr(bytes32 node, address a) external {
        if (msg.sender != owners[node]) revert NotOwner();
        _addr[node] = a;
        emit AddressChanged(node, a);
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        if (msg.sender != owners[node]) revert NotOwner();
        _text[node][key] = value;
        emit TextChanged(node, key, value);
    }

    function addr(bytes32 node) external view returns (address) {
        return _addr[node];
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _text[node][key];
    }

    function nameToNode(string calldata name) external pure returns (bytes32) {
        return namehash(name);
    }

    function namehash(string memory name) public pure returns (bytes32 node) {
        node = bytes32(0);
        if (bytes(name).length == 0) return node;
        // Split on '.' from the right (ENS namehash).
        bytes memory b = bytes(name);
        uint256 end = b.length;
        while (end > 0) {
            uint256 start = end;
            while (start > 0 && b[start - 1] != ".") start--;
            bytes32 label = keccak256(_slice(b, start, end - start));
            node = keccak256(abi.encodePacked(node, label));
            if (start == 0) break;
            end = start - 1;
        }
    }

    function _slice(bytes memory data, uint256 start, uint256 len) private pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = data[start + i];
        }
    }
}
