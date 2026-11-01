=== enter_counter ===
~ location = "counter"
~ shot_location = "counter"
~ shot_mode = "shared"
# cue:location:counter
{letter_read:阿岚的信仍在托盘旁。读过的字不必再读，你们还有自己的话。|托盘里放着写有米拉名字的信封。她认得字迹，随口说是老同事留的，正文还没展开。}
-> menu

=== inspect_letter ===
{letter_read:
    # cue:prop:letter
    信纸再次展开，仍是阿岚留给米拉的那些话。
    -> menu
}
~ letter_read = true
# cue:prop:letter
# voice:storyReadLetter
信纸在吧台暖光里展开。阿岚熟悉的语气，让她看着看着笑出了声。
-> reflect_letter

=== reflect_letter ===
# cue:beat:letter-reflection
# voice:letterKnown
她读完，笑了一下，再抬眼看你。纸上那句“多坐一会儿”，忽然有点像故意的。
-> menu

=== inspect_reply ===
# cue:prop:reply
她的落款还在托盘里，墨迹已经干了。那个晚上，有了一个可以带走的句号。
-> menu
