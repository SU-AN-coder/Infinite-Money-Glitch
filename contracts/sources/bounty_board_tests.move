/// Unit tests for BountyBoard contract
#[test_only]
module bounty_board::bounty_board_tests {
    use sui::test_scenario::{Self as ts, Scenario};
    use sui::coin::{Self};
    use sui::sui::SUI;
    use sui::clock::{Self, Clock};
    use bounty_board::bounty_board::{Self, BountyBoard, Bounty, TaskProof};

    const OWNER: address = @0xCAFE;
    const AGENT: address = @0xBEEF;
    const REWARD_AMOUNT: u64 = 100_000_000; // 0.1 SUI

    fun setup_test(): Scenario {
        ts::begin(OWNER)
    }

    #[test]
    fun test_create_board() {
        let mut scenario = setup_test();
        
        ts::next_tx(&mut scenario, OWNER);
        {
            bounty_board::create_board(ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let board = ts::take_shared<BountyBoard>(&scenario);
            let (treasury, paid, tasks, completed) = bounty_board::get_board_stats(&board);
            assert!(treasury == 0, 0);
            assert!(paid == 0, 1);
            assert!(tasks == 0, 2);
            assert!(completed == 0, 3);
            ts::return_shared(board);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_deposit() {
        let mut scenario = setup_test();

        ts::next_tx(&mut scenario, OWNER);
        {
            bounty_board::create_board(ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let coin = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario)); // 1 SUI
            bounty_board::deposit(&mut board, coin, ts::ctx(&mut scenario));
            
            let (treasury, _, _, _) = bounty_board::get_board_stats(&board);
            assert!(treasury == 1_000_000_000, 0);
            ts::return_shared(board);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_post_bounty() {
        let mut scenario = setup_test();

        // Create board
        ts::next_tx(&mut scenario, OWNER);
        {
            bounty_board::create_board(ts::ctx(&mut scenario));
        };

        // Deposit funds
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let coin = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
            bounty_board::deposit(&mut board, coin, ts::ctx(&mut scenario));
            ts::return_shared(board);
        };

        // Post bounty
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            bounty_board::post_bounty(
                &mut board,
                b"tmp_scan",
                b"Scan /tmp directory for large files",
                REWARD_AMOUNT,
                @0x0, // Any agent
                ts::ctx(&mut scenario)
            );
            
            let (_, _, tasks, _) = bounty_board::get_board_stats(&board);
            assert!(tasks == 1, 0);
            ts::return_shared(board);
        };

        ts::end(scenario);
    }

    #[test]
    fun test_claim_reward() {
        let mut scenario = setup_test();

        // Create board
        ts::next_tx(&mut scenario, OWNER);
        {
            bounty_board::create_board(ts::ctx(&mut scenario));
        };

        // Deposit funds
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let coin = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
            bounty_board::deposit(&mut board, coin, ts::ctx(&mut scenario));
            ts::return_shared(board);
        };

        // Post bounty
        ts::next_tx(&mut scenario, OWNER);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            bounty_board::post_bounty(
                &mut board,
                b"tmp_scan",
                b"Scan /tmp directory",
                REWARD_AMOUNT,
                @0x0,
                ts::ctx(&mut scenario)
            );
            ts::return_shared(board);
        };

        // Create clock for testing
        ts::next_tx(&mut scenario, AGENT);
        {
            let clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::share_for_testing(clock);
        };

        // Agent claims reward
        ts::next_tx(&mut scenario, AGENT);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let mut bounty = ts::take_shared<Bounty>(&scenario);
            let clock = ts::take_shared<Clock>(&scenario);
            
            // SHA-256 hash (32 bytes)
            let task_hash = x"a948904f2f0f479b8f8564e0bac8a6d60e665ae80ba94ccb1e1ae73e3f3dc5c6";
            
            bounty_board::claim_reward(
                &mut board,
                &mut bounty,
                task_hash,
                &clock,
                ts::ctx(&mut scenario)
            );

            // Verify bounty is no longer active
            assert!(!bounty_board::is_bounty_active(&bounty), 0);
            
            // Verify stats updated
            let (_, paid, _, completed) = bounty_board::get_board_stats(&board);
            assert!(paid == REWARD_AMOUNT, 1);
            assert!(completed == 1, 2);

            ts::return_shared(board);
            ts::return_shared(bounty);
            ts::return_shared(clock);
        };

        // Verify agent received the reward coin and proof
        ts::next_tx(&mut scenario, AGENT);
        {
            let reward_coin = ts::take_from_sender<coin::Coin<SUI>>(&scenario);
            assert!(coin::value(&reward_coin) == REWARD_AMOUNT, 0);
            ts::return_to_sender(&scenario, reward_coin);

            let proof = ts::take_from_sender<TaskProof>(&scenario);
            ts::return_to_sender(&scenario, proof);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = bounty_board::bounty_board::E_NOT_OWNER)]
    fun test_post_bounty_not_owner() {
        let mut scenario = setup_test();

        ts::next_tx(&mut scenario, OWNER);
        {
            bounty_board::create_board(ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let coin = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
            bounty_board::deposit(&mut board, coin, ts::ctx(&mut scenario));
            ts::return_shared(board);
        };

        // Non-owner tries to post bounty
        ts::next_tx(&mut scenario, AGENT);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            bounty_board::post_bounty(
                &mut board,
                b"test",
                b"Test task",
                REWARD_AMOUNT,
                @0x0,
                ts::ctx(&mut scenario)
            );
            ts::return_shared(board);
        };

        ts::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = bounty_board::bounty_board::E_BOUNTY_NOT_ACTIVE)]
    fun test_double_claim() {
        let mut scenario = setup_test();

        // Setup board with bounty
        ts::next_tx(&mut scenario, OWNER);
        {
            bounty_board::create_board(ts::ctx(&mut scenario));
        };

        ts::next_tx(&mut scenario, OWNER);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let coin = coin::mint_for_testing<SUI>(1_000_000_000, ts::ctx(&mut scenario));
            bounty_board::deposit(&mut board, coin, ts::ctx(&mut scenario));
            bounty_board::post_bounty(
                &mut board,
                b"test",
                b"Test",
                REWARD_AMOUNT,
                @0x0,
                ts::ctx(&mut scenario)
            );
            ts::return_shared(board);
        };

        ts::next_tx(&mut scenario, AGENT);
        {
            let clock = clock::create_for_testing(ts::ctx(&mut scenario));
            clock::share_for_testing(clock);
        };

        // First claim succeeds
        ts::next_tx(&mut scenario, AGENT);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let mut bounty = ts::take_shared<Bounty>(&scenario);
            let clock = ts::take_shared<Clock>(&scenario);
            let task_hash = x"a948904f2f0f479b8f8564e0bac8a6d60e665ae80ba94ccb1e1ae73e3f3dc5c6";
            
            bounty_board::claim_reward(&mut board, &mut bounty, task_hash, &clock, ts::ctx(&mut scenario));

            ts::return_shared(board);
            ts::return_shared(bounty);
            ts::return_shared(clock);
        };

        // Second claim should fail
        ts::next_tx(&mut scenario, AGENT);
        {
            let mut board = ts::take_shared<BountyBoard>(&scenario);
            let mut bounty = ts::take_shared<Bounty>(&scenario);
            let clock = ts::take_shared<Clock>(&scenario);
            let task_hash = x"b948904f2f0f479b8f8564e0bac8a6d60e665ae80ba94ccb1e1ae73e3f3dc5c6";
            
            bounty_board::claim_reward(&mut board, &mut bounty, task_hash, &clock, ts::ctx(&mut scenario));

            ts::return_shared(board);
            ts::return_shared(bounty);
            ts::return_shared(clock);
        };

        ts::end(scenario);
    }
}
