-- =====================================================================
-- 0014 — five new brain games.
--
-- myday_game_results.game_type is a CHECK constraint, so a new game cannot
-- save a score until its id is allowed here. The client already keeps a
-- failed result on the device and replays it (see flushPendingGameResults),
-- and that queue DROPS rows the server rejects with a 23xxx code — so without
-- this migration a new game's scores would be silently discarded rather than
-- retried. The constraint has to land before the games ship.
-- =====================================================================

alter table myday_game_results drop constraint if exists myday_game_results_game_type_check;
alter table myday_game_results add constraint myday_game_results_game_type_check
  check (game_type in (
    -- the original six
    'match_pairs', 'word_puzzle', 'number_pattern', 'orientation',
    'quick_math', 'odd_one_out',
    -- new
    'word_search', 'unscramble', 'memory_sequence', 'mini_sudoku', 'shopping_recall'
  ));
