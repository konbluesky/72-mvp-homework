=== enter_cafe_front ===
~ location = "cafe-front"
# cue:location:cafe-front
{second_date:旧店的营业牌已经翻面。你们约在这里，等的是彼此，不是重新开门。|{ambience == "closed":门牌翻面，檐下滴水。话题还在，是否继续由你们自己决定。|雨棚把街声压低。隔着一扇门，是还没喝完的咖啡和一个没急着走的人。}}
-> menu

=== inspect_notice ===
~ notice_read = true
# cue:prop:notice
# voice:lastNight
告示写着旧店的最后营业日。米拉念完，往仍亮着灯的窗边看了一眼。
-> menu
