// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {LastOneStanding} from "../src/LastOneStanding.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount);
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Mock6909 {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;

    function setBalance(address owner, uint256 id, uint256 amount) external {
        balanceOf[owner][id] = amount;
    }
}

contract MockMarket {
    uint8 public status = 1;
    bool public isResolved;
    bool public isVoided;
    uint256[] private _payouts;

    function resolve(uint256 yes, uint256 no) external {
        status = 4;
        isResolved = true;
        _payouts.push(yes);
        _payouts.push(no);
    }

    function voidMarket() external {
        status = 5;
        isVoided = true;
    }

    function payoutNumerators() external view returns (uint256[] memory) {
        return _payouts;
    }
}

contract MockModule {
    struct Record {
        address collateral;
        bytes32 venue;
        address market;
        uint256 yesId;
        uint256 noId;
    }

    mapping(bytes32 => Record) public records;

    function set(
        bytes32 id,
        address collateral,
        bytes32 venue,
        address market,
        uint256 yesId,
        uint256 noId
    ) external {
        records[id] = Record(collateral, venue, market, yesId, noId);
    }

    function markets(bytes32 id)
        external
        view
        returns (
            uint256,
            uint8,
            uint8,
            address,
            uint32,
            bytes32,
            address,
            address,
            address,
            address,
            uint256,
            uint256,
            uint64,
            uint64
        )
    {
        Record memory r = records[id];
        return (0, 2, 0, r.collateral, 0, r.venue, address(0), address(0), r.market, address(1), r.yesId, r.noId, 0, 1 days);
    }
}

contract Harness is LastOneStanding {
    constructor(address module, address token, address collateral)
        LastOneStanding(module, token, collateral, address(0), address(0), false)
    {}

    function process(uint32 runId) external {
        _handleTerminal(runId);
    }
}

contract LastOneStandingTest is Test {
    MockERC20 collateral;
    Mock6909 outcome;
    MockModule module;
    MockMarket market;
    Harness game;

    bytes32 constant VENUE = keccak256("dreamdex");
    bytes32 constant MARKET_ID = bytes32(uint256(7));
    uint256 constant YES = 101;
    uint256 constant NO = 102;
    uint256 constant ENTRY = 5e6;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA401);

    function setUp() public {
        collateral = new MockERC20();
        outcome = new Mock6909();
        module = new MockModule();
        market = new MockMarket();
        module.set(MARKET_ID, address(collateral), VENUE, address(market), YES, NO);
        game = new Harness(address(module), address(outcome), address(collateral));
    }

    function _create(uint32 target, uint32 maxRounds) internal returns (uint32) {
        return game.createRun("BTC", 900, VENUE, target, maxRounds, 10, ENTRY, 1e18);
    }

    function _join(uint32 runId, address player) internal {
        collateral.mint(player, ENTRY);
        vm.startPrank(player);
        collateral.approve(address(game), ENTRY);
        game.register(runId);
        vm.stopPrank();
    }

    function testCorrectSurvivesAndWrongPlayerIsEliminated() public {
        uint32 runId = _create(1, 5);
        _join(runId, alice);
        _join(runId, bob);
        game.startRun(runId, MARKET_ID);
        outcome.setBalance(alice, YES, 1e18);
        market.resolve(1, 0);
        game.process(runId);

        assertEq(game.getAlive(runId).length, 1);
        assertEq(game.getAlive(runId)[0], alice);
        assertTrue(game.eliminated(runId, bob));
        assertEq(uint8(game.getRun(runId).status), uint8(LastOneStanding.RunStatus.Finalized));
    }

    function testUnderMinimumIsEliminated() public {
        uint32 runId = _create(1, 5);
        _join(runId, alice);
        outcome.setBalance(alice, YES, 1e18 - 1);
        game.startRun(runId, MARKET_ID);
        market.resolve(1, 0);
        game.process(runId);
        assertTrue(game.claimant(runId, alice)); // wipeout restores round starters
    }

    function testVoidedRoundDoesNotIncrementRound() public {
        uint32 runId = _create(1, 2);
        _join(runId, alice);
        game.startRun(runId, MARKET_ID);
        market.voidMarket();
        game.process(runId);
        assertEq(game.getRun(runId).roundCount, 0);
        assertEq(uint8(game.getRun(runId).status), uint8(LastOneStanding.RunStatus.AwaitingRound));
    }

    function testWipeoutSplitsAmongRoundStarters() public {
        uint32 runId = _create(1, 3);
        _join(runId, alice);
        _join(runId, bob);
        game.startRun(runId, MARKET_ID);
        market.resolve(1, 0);
        game.process(runId);
        assertTrue(game.claimant(runId, alice));
        assertTrue(game.claimant(runId, bob));

        vm.prank(alice);
        game.claim(runId);
        vm.prank(bob);
        game.claim(runId);
        assertEq(collateral.balanceOf(alice), ENTRY);
        assertEq(collateral.balanceOf(bob), ENTRY);
    }

    function testMaxRoundsSplitsRemainingPlayers() public {
        uint32 runId = _create(1, 1);
        _join(runId, alice);
        _join(runId, bob);
        outcome.setBalance(alice, YES, 1e18);
        outcome.setBalance(bob, YES, 1e18);
        game.startRun(runId, MARKET_ID);
        market.resolve(1, 0);
        game.process(runId);
        assertTrue(game.claimant(runId, alice));
        assertTrue(game.claimant(runId, bob));
    }

    function testVenueMismatchReverts() public {
        uint32 runId = _create(1, 2);
        _join(runId, alice);
        module.set(MARKET_ID, address(collateral), bytes32("wrong"), address(market), YES, NO);
        vm.expectRevert(LastOneStanding.VenueMismatch.selector);
        game.startRun(runId, MARKET_ID);
    }

    function testCannotClaimTwice() public {
        uint32 runId = _create(1, 1);
        _join(runId, alice);
        outcome.setBalance(alice, YES, 1e18);
        game.startRun(runId, MARKET_ID);
        market.resolve(1, 0);
        game.process(runId);
        vm.prank(alice);
        game.claim(runId);
        vm.prank(alice);
        vm.expectRevert(LastOneStanding.NothingToClaim.selector);
        game.claim(runId);
    }

    function testTerminalHandlingIsIdempotent() public {
        uint32 runId = _create(1, 2);
        _join(runId, alice);
        game.startRun(runId, MARKET_ID);
        market.resolve(1, 0);
        game.process(runId);
        game.process(runId);
        assertEq(game.getRun(runId).roundCount, 1);
    }
}
