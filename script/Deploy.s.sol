// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {LastOneStanding} from "../src/LastOneStanding.sol";

contract Deploy is Script {
    address constant BINARY_MODULE = 0x3ecC694Cef705358864a646142ac17A90E29e388;
    address constant OUTCOME_TOKEN = 0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9;
    address constant TESTNET_COLLATERAL = 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E;
    address constant TESTNET_AGENTS = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;

    function run() external {
        address armorer = vm.envAddress("ARMORER_ADDRESS");
        vm.startBroadcast();
        LastOneStanding game = new LastOneStanding{value: 33 ether}(
            BINARY_MODULE,
            OUTCOME_TOKEN,
            TESTNET_COLLATERAL,
            TESTNET_AGENTS,
            armorer,
            true
        );
        vm.stopBroadcast();
        console.log("LastOneStanding:", address(game));
    }
}
