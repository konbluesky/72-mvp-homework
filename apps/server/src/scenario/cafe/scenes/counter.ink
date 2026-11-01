=== enter_counter ===
~ location = "counter"
# cue:location:counter
{letter_read:那封信仍在托盘旁。可以重读，也可以继续聊别的。|托盘旁，一封信写着米拉的名字。她认出笔迹，却没有马上伸手。}
~ counter_seen = true
-> menu

=== inspect_letter ===
{letter_read:
    # cue:prop:letter
    信纸再次展开，文字仍然是刚才那些。你们可以慢慢读。
    -> menu
}
~ letter_read = true
# cue:prop:letter
# voice:storyReadLetter
信纸在托盘上展开。先一起看完，再听听她的感受。
-> reflect_letter

=== reflect_letter ===
~ letter_reflected = true
~ phase = 2
# cue:beat:letter-reflection
# voice:letterKnown
她终于知道阿岚下午来过。接下来想怎么回应，可以由她慢慢决定。
-> menu

=== inspect_reply ===
# cue:prop:reply
回信还在托盘里，没有因为你们离开而消失。
-> menu
