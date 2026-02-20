/// BountyBoard - Sui Move earning contract for Infinite Money Glitch
/// 
/// This contract enables agents to earn SUI by completing tasks:
/// 1. Board owner deposits SUI into the treasury
/// 2. Owner posts bounty tasks with reward amounts
/// 3. Agent executes task and submits SHA-256 proof of work
/// 4. Contract verifies and releases reward to agent
module bounty_board::bounty_board {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use sui::clock::Clock;

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════
    
    const E_NOT_OWNER: u64 = 0;
    const E_BOUNTY_NOT_ACTIVE: u64 = 1;
    const E_INSUFFICIENT_FUNDS: u64 = 2;
    const E_ALREADY_CLAIMED: u64 = 3;
    const E_INVALID_AGENT: u64 = 4;
    const E_PROOF_TOO_SHORT: u64 = 5;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Emitted when a new bounty is created
    public struct BountyCreated has copy, drop {
        bounty_id: address,
        task_type: vector<u8>,
        reward_amount: u64,
        creator: address,
    }

    /// Emitted when a bounty is claimed by an agent
    public struct BountyClaimed has copy, drop {
        bounty_id: address,
        agent: address,
        task_hash: vector<u8>,
        reward_amount: u64,
        timestamp_ms: u64,
    }

    /// Emitted when funds are deposited to the board
    public struct FundsDeposited has copy, drop {
        depositor: address,
        amount: u64,
        new_balance: u64,
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // OBJECTS
    // ═══════════════════════════════════════════════════════════════════════════

    /// BountyBoard: The main shared object managing all bounties
    public struct BountyBoard has key {
        id: UID,
        owner: address,
        treasury: Balance<SUI>,
        total_paid: u64,
        total_tasks: u64,
        total_completed: u64,
    }

    /// Bounty: A single task with reward
    public struct Bounty has key, store {
        id: UID,
        board: address,
        task_type: vector<u8>,      // "tmp_scan" | "system_check" | "git_status" ...
        description: vector<u8>,
        reward_amount: u64,         // MIST (1 SUI = 1_000_000_000 MIST)
        is_active: bool,
        creator: address,
        assigned_agent: address,    // 0x0 = any agent can claim
    }

    /// TaskProof: Permanent on-chain record of completed work
    public struct TaskProof has key, store {
        id: UID,
        bounty_id: address,
        agent: address,
        task_hash: vector<u8>,      // SHA-256 of task output
        reward_amount: u64,
        completed_at: u64,          // timestamp_ms
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Create a new BountyBoard (shared object)
    public entry fun create_board(ctx: &mut TxContext) {
        let board = BountyBoard {
            id: object::new(ctx),
            owner: ctx.sender(),
            treasury: balance::zero(),
            total_paid: 0,
            total_tasks: 0,
            total_completed: 0,
        };
        transfer::share_object(board);
    }

    /// Deposit SUI into the board treasury (anyone can deposit)
    public entry fun deposit(
        board: &mut BountyBoard,
        payment: Coin<SUI>,
        ctx: &TxContext,
    ) {
        let amount = coin::value(&payment);
        balance::join(&mut board.treasury, coin::into_balance(payment));
        
        event::emit(FundsDeposited {
            depositor: ctx.sender(),
            amount,
            new_balance: balance::value(&board.treasury),
        });
    }

    /// Post a new bounty task (owner only)
    public entry fun post_bounty(
        board: &mut BountyBoard,
        task_type: vector<u8>,
        description: vector<u8>,
        reward_amount: u64,
        assigned_agent: address,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == board.owner, E_NOT_OWNER);
        assert!(balance::value(&board.treasury) >= reward_amount, E_INSUFFICIENT_FUNDS);

        let bounty = Bounty {
            id: object::new(ctx),
            board: object::uid_to_address(&board.id),
            task_type,
            description,
            reward_amount,
            is_active: true,
            creator: ctx.sender(),
            assigned_agent,
        };

        let bounty_addr = object::uid_to_address(&bounty.id);

        event::emit(BountyCreated {
            bounty_id: bounty_addr,
            task_type,
            reward_amount,
            creator: ctx.sender(),
        });

        board.total_tasks = board.total_tasks + 1;
        transfer::share_object(bounty);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AGENT FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Agent submits task proof and claims bounty reward
    public entry fun claim_reward(
        board: &mut BountyBoard,
        bounty: &mut Bounty,
        task_hash: vector<u8>,  // SHA-256 of the actual task output (32 bytes)
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let agent = ctx.sender();

        // Validations
        assert!(bounty.is_active, E_BOUNTY_NOT_ACTIVE);
        assert!(
            bounty.assigned_agent == @0x0 || bounty.assigned_agent == agent,
            E_INVALID_AGENT
        );
        assert!(
            balance::value(&board.treasury) >= bounty.reward_amount,
            E_INSUFFICIENT_FUNDS
        );
        assert!(vector::length(&task_hash) >= 32, E_PROOF_TOO_SHORT);

        // Mark as completed
        bounty.is_active = false;

        // Transfer reward
        let reward = coin::take(
            &mut board.treasury,
            bounty.reward_amount,
            ctx
        );
        transfer::public_transfer(reward, agent);
        board.total_paid = board.total_paid + bounty.reward_amount;
        board.total_completed = board.total_completed + 1;

        let timestamp = clock.timestamp_ms();

        // Create on-chain proof
        let proof = TaskProof {
            id: object::new(ctx),
            bounty_id: object::uid_to_address(&bounty.id),
            agent,
            task_hash,
            reward_amount: bounty.reward_amount,
            completed_at: timestamp,
        };

        event::emit(BountyClaimed {
            bounty_id: object::uid_to_address(&bounty.id),
            agent,
            task_hash,
            reward_amount: bounty.reward_amount,
            timestamp_ms: timestamp,
        });

        // Transfer proof to agent for auditing
        transfer::transfer(proof, agent);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    /// Get board statistics
    public fun get_board_stats(board: &BountyBoard): (u64, u64, u64, u64) {
        (
            balance::value(&board.treasury),
            board.total_paid,
            board.total_tasks,
            board.total_completed
        )
    }

    /// Check if bounty is active
    public fun is_bounty_active(bounty: &Bounty): bool {
        bounty.is_active
    }

    /// Get bounty reward amount
    public fun get_reward_amount(bounty: &Bounty): u64 {
        bounty.reward_amount
    }

    /// Get bounty task type
    public fun get_task_type(bounty: &Bounty): vector<u8> {
        bounty.task_type
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // TEST HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    #[test_only]
    public fun create_board_for_testing(ctx: &mut TxContext): BountyBoard {
        BountyBoard {
            id: object::new(ctx),
            owner: ctx.sender(),
            treasury: balance::zero(),
            total_paid: 0,
            total_tasks: 0,
            total_completed: 0,
        }
    }
}
