=== talk_off_duty ===
~ trust = true
~ phase = 2
# cue:beat:off-duty
# voice:offDuty
她停了一下，没有立刻用玩笑接过去。窗外的雨声还在，这回她认真看着你说。
-> menu

=== talk_spark ===
~ chemistry = true
# cue:beat:first-spark
# voice:spark
她没有躲开你的目光，嘴角却先泄露了一点得意。桌上那段不远不近的距离，忽然变得有些在意。
-> menu

=== talk_boundary ===
~ boundary_set = true
~ boundary_repaired = false
# cue:beat:slow-down
# voice:boundary
她收住调侃，把声音放回平常的温度。咖啡还没喝完，你们可以换个舒服的话题。
-> menu

=== talk_reopen ===
~ boundary_repaired = true
~ chemistry = true
# cue:beat:reopened
# voice:reopen
她听完你的话，轻轻点头。不是假装刚才什么都没发生，而是终于知道彼此想怎么往前走。
-> menu

=== make_appointment ===
~ appointment = true
# cue:prop:appointment
# voice:appointment
约定便笺在暖光里展开。“不用等雨”几个字，比刚才的玩笑认真一些。
-> menu
