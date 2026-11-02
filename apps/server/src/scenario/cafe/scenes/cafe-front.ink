=== enter_cafe_front ===
~ location = "cafe-front"
~ shot_location = "cafe-front"
~ shot_mode = "shared"
{not met:
    ~ beat = "arrival-front"
}
{companionship && not second_date && ending == "":
    ~ beat = "first-choice"
    ~ phase = 2
}
# cue:location:cafe-front
{not met:雨水顺着雨棚落下，门上的营业牌还朝着外面。透过玻璃，窗边有个独自坐着的身影；她没有注意到你。你可以看看门边的告示，再决定要不要进去。|{second_date:旧店的营业牌已经翻面。你们约在这里，等的是彼此，不是重新开门。|{ambience == "closed":门牌翻面，檐下滴水。话题还在，是否继续由你们自己决定。|雨棚把街声压低。隔着一扇门，是还没喝完的咖啡和一个没急着走的人。}}}
-> menu

=== inspect_notice ===
~ notice_read = true
{met:
# cue:prop:notice
告示写着旧店的最后营业日。米拉念完，往仍亮着灯的窗边看了一眼。
- else:
# cue:prop:notice
告示写着：今晚是旧店的最后营业日，之后将搬迁。玻璃门还没关，你仍可以选择进店或离开。
}
-> menu
