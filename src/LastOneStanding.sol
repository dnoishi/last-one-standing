// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {
    SomniaEventHandler
} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {
    SomniaExtensions
} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {IBinaryMarket, IBinaryMarketsModule, IERC20, IERC6909} from "./interfaces/IDreamDex.sol";
import {
    IAgentRequester,
    ILLMAgent,
    Request,
    Response,
    ResponseStatus
} from "./interfaces/IAgents.sol";

contract LastOneStanding is SomniaEventHandler {
    enum RunStatus {
        None,
        Registration,
        Live,
        AwaitingRound,
        Finalized
    }

    struct Run {
        string seriesAsset;
        uint64 intervalSec;
        bytes32 venueId;
        uint32 targetSurvivors;
        uint32 maxRounds;
        uint32 maxPlayers;
        uint32 roundCount;
        uint32 survivorCount;
        uint32 claimantCount;
        uint32 claimedCount;
        uint256 entryStake;
        uint256 minPosition;
        uint256 prizePool;
        uint256 unclaimedPrize;
        bytes32 trackedMarketId;
        address marketAddress;
        uint256 yesId;
        uint256 noId;
        uint256 subscriptionId;
        RunStatus status;
    }

    bytes32 public constant STATUS_CHANGED_TOPIC = keccak256("StatusChanged(uint8,uint8)");
    uint8 public constant MARKET_TRADING = 1;
    uint8 public constant MARKET_RESOLVED = 4;
    uint8 public constant MARKET_VOIDED = 5;
    uint32 public constant HARD_MAX_PLAYERS = 32;
    uint64 public constant DEFAULT_HANDLER_GAS = 12_000_000;
    uint256 public constant LLM_AGENT_ID = 12847293847561029384;
    uint256 public constant LLM_REWARD = 0.21 ether;
    uint256 public constant REACTIVITY_BALANCE_FLOOR = 32 ether;

    address public owner;
    address public armorer;
    IBinaryMarketsModule public immutable binaryModule;
    IERC6909 public immutable outcomeToken;
    IERC20 public immutable collateral;
    IAgentRequester public immutable agents;
    bool public immutable subscriptionsEnabled;
    uint32 public nextRunId = 1;

    mapping(uint32 runId => Run run) private _runs;
    mapping(uint32 runId => address[] players) private _players;
    mapping(uint32 runId => address[] alive) private _alive;
    mapping(uint32 runId => address[] roundStart) private _roundStart;
    mapping(uint32 runId => mapping(address player => bool value)) public registered;
    mapping(uint32 runId => mapping(address player => bool value)) public eliminated;
    mapping(uint32 runId => mapping(address player => uint32 round)) public eliminatedInRound;
    mapping(uint32 runId => mapping(address player => bool value)) public claimant;
    mapping(uint32 runId => mapping(address player => bool value)) public claimed;
    mapping(uint32 runId => mapping(bytes32 marketId => bool value)) public roundHandled;
    mapping(address market => uint32 runId) public runByMarket;
    mapping(uint256 requestId => uint32 runId) public requestRun;
    mapping(uint256 requestId => uint32 round) public requestRound;
    mapping(uint32 runId => mapping(uint32 round => string text)) public commentary;

    event RunCreated(uint32 indexed runId, string asset, uint64 intervalSec);
    event PlayerRegistered(uint32 indexed runId, address indexed player);
    event RoundArmed(uint32 indexed runId, uint32 indexed round, bytes32 indexed marketId);
    event PlayerEliminated(uint32 indexed runId, uint32 indexed round, address indexed player);
    event RoundSettled(
        uint32 indexed runId,
        uint32 indexed round,
        bytes32 indexed marketId,
        uint8 winningSide,
        uint32 eliminatedCount,
        uint32 survivorsRemaining
    );
    event RoundVoided(uint32 indexed runId, uint32 indexed round, bytes32 indexed marketId);
    event RunFinalized(uint32 indexed runId, uint32 claimantCount, uint256 prizePool);
    event Claimed(uint32 indexed runId, address indexed player, uint256 amount);
    event CommentaryRequested(uint256 indexed requestId, uint32 indexed runId, uint32 round);
    event CommentaryReady(uint32 indexed runId, uint32 indexed round, string text);
    event CommentaryFailed(uint32 indexed runId, uint32 indexed round, ResponseStatus status);

    error Unauthorized();
    error InvalidRun();
    error InvalidConfiguration();
    error WrongStatus();
    error RunFull();
    error AlreadyRegistered();
    error TransferFailed();
    error MarketUnavailable();
    error VenueMismatch();
    error MarketAlreadyTracked();
    error NothingToClaim();
    error WrongEmitter();
    error UnknownAgentRequest();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != owner && msg.sender != armorer) revert Unauthorized();
        _;
    }

    constructor(
        address binaryModule_,
        address outcomeToken_,
        address collateral_,
        address agents_,
        address armorer_,
        bool subscriptionsEnabled_
    ) payable {
        if (
            binaryModule_ == address(0) || outcomeToken_ == address(0)
                || collateral_ == address(0)
        ) revert InvalidConfiguration();
        owner = msg.sender;
        armorer = armorer_;
        binaryModule = IBinaryMarketsModule(binaryModule_);
        outcomeToken = IERC6909(outcomeToken_);
        collateral = IERC20(collateral_);
        agents = IAgentRequester(agents_);
        subscriptionsEnabled = subscriptionsEnabled_;
    }

    receive() external payable {}

    function setArmorer(address newArmorer) external onlyOwner {
        armorer = newArmorer;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidConfiguration();
        owner = newOwner;
    }

    function createRun(
        string calldata seriesAsset,
        uint64 intervalSec,
        bytes32 venueId,
        uint32 targetSurvivors,
        uint32 maxRounds,
        uint32 maxPlayers,
        uint256 entryStake,
        uint256 minPosition
    ) external onlyOwner returns (uint32 runId) {
        if (
            bytes(seriesAsset).length == 0 || intervalSec == 0 || targetSurvivors == 0
                || maxRounds == 0 || maxPlayers < targetSurvivors
                || maxPlayers > HARD_MAX_PLAYERS || entryStake == 0 || minPosition == 0
        ) revert InvalidConfiguration();
        runId = nextRunId++;
        Run storage run = _runs[runId];
        run.seriesAsset = seriesAsset;
        run.intervalSec = intervalSec;
        run.venueId = venueId;
        run.targetSurvivors = targetSurvivors;
        run.maxRounds = maxRounds;
        run.maxPlayers = maxPlayers;
        run.entryStake = entryStake;
        run.minPosition = minPosition;
        run.status = RunStatus.Registration;
        emit RunCreated(runId, seriesAsset, intervalSec);
    }

    function register(uint32 runId) external {
        Run storage run = _requireRun(runId);
        if (run.status != RunStatus.Registration) revert WrongStatus();
        if (registered[runId][msg.sender]) revert AlreadyRegistered();
        if (_players[runId].length >= run.maxPlayers) revert RunFull();
        if (!collateral.transferFrom(msg.sender, address(this), run.entryStake)) {
            revert TransferFailed();
        }
        registered[runId][msg.sender] = true;
        _players[runId].push(msg.sender);
        _alive[runId].push(msg.sender);
        run.survivorCount++;
        run.prizePool += run.entryStake;
        emit PlayerRegistered(runId, msg.sender);
    }

    function startRun(uint32 runId, bytes32 marketId) external onlyOperator {
        Run storage run = _requireRun(runId);
        if (run.status != RunStatus.Registration || run.survivorCount == 0) revert WrongStatus();
        run.status = RunStatus.AwaitingRound;
        _armForRound(runId, marketId);
    }

    function armForRound(uint32 runId, bytes32 marketId) external onlyOperator {
        Run storage run = _requireRun(runId);
        if (run.status != RunStatus.AwaitingRound) revert WrongStatus();
        _armForRound(runId, marketId);
    }

    function _armForRound(uint32 runId, bytes32 marketId) internal {
        Run storage run = _runs[runId];
        (
            ,
            ,
            ,
            address marketCollateral,
            ,
            bytes32 venueId,
            ,
            ,
            address market,
            ,
            uint256 yesId,
            uint256 noId,
            ,
        ) = binaryModule.markets(marketId);
        if (market == address(0) || IBinaryMarket(market).status() != MARKET_TRADING) {
            revert MarketUnavailable();
        }
        if (marketCollateral != address(collateral)) revert MarketUnavailable();
        if (venueId != run.venueId) revert VenueMismatch();
        if (runByMarket[market] != 0) revert MarketAlreadyTracked();

        if (run.marketAddress != address(0)) {
            delete runByMarket[run.marketAddress];
        }
        if (subscriptionsEnabled && run.subscriptionId != 0) {
            SomniaExtensions.unsubscribe(run.subscriptionId);
        }

        run.trackedMarketId = marketId;
        run.marketAddress = market;
        run.yesId = yesId;
        run.noId = noId;
        run.status = RunStatus.Live;
        runByMarket[market] = runId;

        delete _roundStart[runId];
        address[] storage alive = _alive[runId];
        for (uint256 i; i < alive.length; ++i) {
            _roundStart[runId].push(alive[i]);
        }

        if (subscriptionsEnabled) {
            SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions
                .SubscriptionFilter({
                eventTopics: [STATUS_CHANGED_TOPIC, bytes32(0), bytes32(0), bytes32(0)],
                origin: address(0),
                emitter: market
            });
            SomniaExtensions.SubscriptionOptions memory options = SomniaExtensions
                .SubscriptionOptions({
                priorityFeePerGas: SomniaExtensions.DEFAULT_PRIORITY_FEE_PER_GAS,
                maxFeePerGas: SomniaExtensions.DEFAULT_MAX_FEE_PER_GAS,
                gasLimit: DEFAULT_HANDLER_GAS
            });
            run.subscriptionId = SomniaExtensions.subscribe(address(this), filter, options);
        }
        emit RoundArmed(runId, run.roundCount + 1, marketId);
    }

    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata)
        internal
        override
    {
        uint32 runId = runByMarket[emitter];
        if (runId == 0) revert WrongEmitter();
        if (
            eventTopics.length < 3 || eventTopics[0] != STATUS_CHANGED_TOPIC
                || uint8(uint256(eventTopics[2])) < MARKET_RESOLVED
        ) return;
        _handleTerminal(runId);
    }

    function _handleTerminal(uint32 runId) internal {
        Run storage run = _runs[runId];
        bytes32 marketId = run.trackedMarketId;
        if (run.status != RunStatus.Live || roundHandled[runId][marketId]) return;
        IBinaryMarket market = IBinaryMarket(run.marketAddress);
        bool voided = market.isVoided();
        if (!voided && !market.isResolved()) revert MarketUnavailable();
        roundHandled[runId][marketId] = true;
        run.status = RunStatus.AwaitingRound;
        delete runByMarket[run.marketAddress];

        if (voided) {
            emit RoundVoided(runId, run.roundCount + 1, marketId);
            return;
        }

        uint256[] memory payouts = market.payoutNumerators();
        if (payouts.length < 2) revert MarketUnavailable();
        uint8 winningSide = payouts[0] >= payouts[1] ? 0 : 1;
        uint256 winningId = winningSide == 0 ? run.yesId : run.noId;
        run.roundCount++;

        address[] storage alive = _alive[runId];
        uint256 writeIndex;
        uint32 eliminatedCount;
        for (uint256 i; i < alive.length; ++i) {
            address player = alive[i];
            if (outcomeToken.balanceOf(player, winningId) < run.minPosition) {
                eliminated[runId][player] = true;
                eliminatedInRound[runId][player] = run.roundCount;
                eliminatedCount++;
                emit PlayerEliminated(runId, run.roundCount, player);
            } else {
                alive[writeIndex++] = player;
            }
        }
        while (alive.length > writeIndex) alive.pop();
        run.survivorCount = uint32(writeIndex);

        emit RoundSettled(
            runId,
            run.roundCount,
            marketId,
            winningSide,
            eliminatedCount,
            run.survivorCount
        );

        if (run.survivorCount == 0) {
            _finalize(runId, _roundStart[runId]);
        } else if (
            run.survivorCount <= run.targetSurvivors || run.roundCount >= run.maxRounds
        ) {
            _finalize(runId, alive);
        }
        _requestCommentary(runId, winningSide, eliminatedCount);
    }

    function _finalize(uint32 runId, address[] storage winners) internal {
        Run storage run = _runs[runId];
        run.status = RunStatus.Finalized;
        run.claimantCount = uint32(winners.length);
        run.survivorCount = uint32(winners.length);
        run.unclaimedPrize = run.prizePool;
        for (uint256 i; i < winners.length; ++i) claimant[runId][winners[i]] = true;
        emit RunFinalized(runId, run.claimantCount, run.prizePool);
    }

    function claim(uint32 runId) external {
        Run storage run = _requireRun(runId);
        if (
            run.status != RunStatus.Finalized || !claimant[runId][msg.sender]
                || claimed[runId][msg.sender]
        ) revert NothingToClaim();
        claimed[runId][msg.sender] = true;
        run.claimedCount++;
        uint256 amount = run.claimedCount == run.claimantCount
            ? run.unclaimedPrize
            : run.prizePool / run.claimantCount;
        run.unclaimedPrize -= amount;
        if (!collateral.transfer(msg.sender, amount)) revert TransferFailed();
        emit Claimed(runId, msg.sender, amount);
    }

    function _requestCommentary(uint32 runId, uint8 winningSide, uint32 eliminatedCount)
        internal
    {
        if (address(agents) == address(0)) return;
        uint256 reserve;
        try agents.getRequestDeposit() returns (uint256 value) {
            reserve = value;
        } catch {
            return;
        }
        uint256 deposit = reserve + LLM_REWARD;
        if (address(this).balance < REACTIVITY_BALANCE_FLOOR + deposit) return;

        Run storage run = _runs[runId];
        string[] memory allowed = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            string.concat(
                "Round ",
                _toString(run.roundCount),
                ": ",
                winningSide == 0 ? "Up" : "Down",
                " won; ",
                _toString(eliminatedCount),
                " eliminated; ",
                _toString(run.survivorCount),
                " remain. Write one short sports-broadcast sentence."
            ),
            "You are the concise announcer for Last One Standing.",
            false,
            allowed
        );
        try agents.createRequest{value: deposit}(
            LLM_AGENT_ID, address(this), this.handleResponse.selector, payload
        ) returns (uint256 requestId) {
            requestRun[requestId] = runId;
            requestRound[requestId] = run.roundCount;
            emit CommentaryRequested(requestId, runId, run.roundCount);
        } catch {}
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external {
        if (msg.sender != address(agents)) revert Unauthorized();
        uint32 runId = requestRun[requestId];
        if (runId == 0) revert UnknownAgentRequest();
        uint32 round = requestRound[requestId];
        delete requestRun[requestId];
        delete requestRound[requestId];

        if (status == ResponseStatus.Success) {
            for (uint256 i; i < responses.length; ++i) {
                if (responses[i].status != ResponseStatus.Success) continue;
                uint256 matches;
                bytes32 candidate = keccak256(responses[i].result);
                for (uint256 j; j < responses.length; ++j) {
                    if (
                        responses[j].status == ResponseStatus.Success
                            && keccak256(responses[j].result) == candidate
                    ) matches++;
                }
                if (matches >= details.threshold) {
                    string memory text = abi.decode(responses[i].result, (string));
                    commentary[runId][round] = text;
                    emit CommentaryReady(runId, round, text);
                    return;
                }
            }
        }
        emit CommentaryFailed(runId, round, status);
    }

    function getRun(uint32 runId) external view returns (Run memory) {
        return _runs[runId];
    }

    function getPlayers(uint32 runId) external view returns (address[] memory) {
        return _players[runId];
    }

    function getAlive(uint32 runId) external view returns (address[] memory) {
        return _alive[runId];
    }

    function _requireRun(uint32 runId) internal view returns (Run storage run) {
        run = _runs[runId];
        if (run.status == RunStatus.None) revert InvalidRun();
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 copy = value;
        uint256 length;
        while (copy != 0) {
            length++;
            copy /= 10;
        }
        bytes memory buffer = new bytes(length);
        while (value != 0) {
            buffer[--length] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }
}
