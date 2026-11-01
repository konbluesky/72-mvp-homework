=== enter_photo_corridor ===
~ location = "photo-corridor"
# cue:location:photo-corridor
{exhibition_read:回到走廊，那张联展海报又让你们想起共同的旅程。|取走相框的墙上，还留着一张联展海报。她等你决定是否走近看看。}
-> menu

=== inspect_exhibition ===
~ exhibition_read = true
# cue:prop:exhibition
# voice:gallery
海报署名米拉与阿岚。她们曾一起旅行，也一起办过摄影展。
-> menu
