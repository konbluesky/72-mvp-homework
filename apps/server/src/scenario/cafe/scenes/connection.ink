=== talk_spark ===
~ chemistry = true
# cue:beat:mutual-interest
你表达了进一步认识她的兴趣，她也愿意试着了解。其他关系与接触仍没有作出约定。
-> menu

=== talk_boundary ===
~ boundary_set = true
~ boundary_repaired = false
# cue:beat:slow-down
你说清希望放慢或保持普通相处，她接受这个距离。
-> menu

=== talk_reopen ===
~ boundary_repaired = true
# cue:beat:reopened
双方同意重新试着了解，之前的分寸仍值得被记住。
-> menu

=== play_game ===
~ game_played = true
# cue:beat:three-statements
# voice:game
她提出一个轻松的猜谜。参与游戏没有改变双方的关系。
-> menu

=== game_first ===
~ game_answered = true
# cue:beat:game-answer-first
# voice:gameWrong
你选了第一句，她公布答案。
-> menu

=== game_second ===
~ game_answered = true
# cue:beat:game-answer-second
# voice:gameWrong
你选了第二句，她公布答案。
-> menu

=== game_third ===
~ game_answered = true
# cue:beat:game-answer-third
# voice:gameRight
你选了第三句，她公布答案。
-> menu
