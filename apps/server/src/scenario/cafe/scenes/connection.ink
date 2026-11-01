=== talk_off_duty ===
~ trust = true
~ phase = 2
# cue:beat:off-duty
# voice:offDuty
# thought:off-duty
她停了一下，没有立刻用玩笑接过去。窗外的雨声还在，这回她认真看着你说。
-> menu

=== talk_spark ===
~ chemistry = true
# cue:beat:first-spark
# voice:spark
# thought:spark
她没有躲开你的目光，嘴角却先泄露了一点得意。两人之间那段不远不近的距离，忽然变得有些在意。
-> menu

=== talk_boundary ===
~ boundary_set = true
~ boundary_repaired = false
# cue:beat:slow-down
# voice:boundary
# thought:slower
{second_date:她收住调侃，让街道上的步子也慢下来。你们可以换个舒服的话题。|她收住调侃，把声音放回平常的温度。你们可以换个舒服的话题。}
-> menu

=== talk_reopen ===
~ boundary_repaired = true
~ chemistry = true
# cue:beat:reopened
# voice:reopen
# thought:reopened
她听完你的话，轻轻点头。不是假装刚才什么都没发生，而是终于知道彼此想怎么往前走。
-> menu

=== play_game ===
~ game_played = true
# cue:beat:three-truths
# voice:game
她把三句话摆出来，带着一点等你上当的笑。每一句都像真的，她倒不急着要答案。
-> menu

=== game_first ===
~ game_answered = true
# cue:beat:game-answer
# voice:gameWrong
# thought:game-wrong
她笑着摇头。答案揭晓以后，那句“再坐一会儿”忽然多了一层可以慢慢听懂的意思。
-> menu

=== game_second ===
~ game_answered = true
# cue:beat:game-answer
# voice:gameWrong
# thought:game-wrong
她笑着摇头。认识一张航线图，和在一条陌生小巷里不迷路，原来不是一回事。
-> menu

=== game_third ===
~ game_answered = true
# cue:beat:game-answer
# voice:gameRight
# thought:game-right
她被你猜中，却没有急着把目光移走。那一点嘴硬，留在笑里就没那么难承认。
-> menu
