# Music Server Roadmap

## Tầm nhìn

Xây dựng một Music Server self-hosted hiện đại, hướng tới các trải nghiệm cốt lõi của:

- Navidrome
- Plex Music
- Roon

Ưu tiên:

- Nhanh
- Ổn định
- Quản lý thư viện lớn
- Metadata tốt
- Trải nghiệm nghe nhạc tốt

Không theo hướng:

- Spotify clone
- AI recommendation platform
- Social network
- Streaming service

## Phase 1 - Foundation

Status: **DONE**

Đã hoàn thành:

- Library Scan
- SQLite Library
- Songs
- Albums
- Artists
- Search
- Queue
- Favorites
- Playlists
- Hero Player
- Last.fm Integration
- Wikidata Integration
- Artist Detail
- Album Detail
- Smart Collections
- Listening Stats
- Virtualized Song List

## Phase 2 - Core Music Experience

Status: **IN PROGRESS** (khoảng 80%)

Mục tiêu: đạt mức sử dụng hằng ngày tương đương Navidrome.

### v3.2 Discovery Engine

Cần hoàn thành:

- Similar Artists
- Artist Radio
- Album Radio
- Track Radio
- Auto Mix
- Daily Mix

Yêu cầu:

- Queue persistence
- Recommendation quality
- UI polish
- Runtime stability

Definition of Done:

- Similar Artists không flicker
- Artist Radio hoạt động ổn định
- Queue survive reload
- Recommendation không gợi ý linh tinh
- Mobile UX ổn định
- Desktop UX ổn định

Chi tiết implementation: [V3.2-PLAN.md](V3.2-PLAN.md)

## Phase 3 - Playback Experience

Status: **NOT STARTED**

Mục tiêu: tiệm cận Plexamp. Đây là ưu tiên rất cao vì người dùng cảm nhận trực tiếp mỗi ngày.

Tính năng:

- Gapless Playback
- Crossfade
- ReplayGain
- Smart Queue
- Queue History
- Resume Playback
- Recently Played Improvements
- Up Next Improvements

Definition of Done:

- Chuyển bài mượt
- Không hụt đầu/cuối bài
- Khôi phục phiên nghe
- Queue đáng tin cậy

## Phase 4 - Multi-user

Status: **NOT STARTED**

Mục tiêu: tiệm cận Navidrome.

Tính năng:

- Multi-user
- User Profiles
- User Libraries
- User Favorites
- User Playlists
- Listening History per User

Admin:

- User Management
- Scan Scheduler
- Library Monitoring

Definition of Done:

- Nhiều user dùng chung server
- Dữ liệu tách biệt
- Playlist riêng
- Favorites riêng

## Phase 5 - Self-hosted Experience

Status: **IN PROGRESS** (khoảng 20%)

Mục tiêu: server có thể chạy lâu dài như một sản phẩm thực tế.

Tính năng:

- Scheduled Scan
- Watch Folder
- Health Monitoring
- Backup / Restore
- Reverse Proxy Ready
- HTTPS Ready
- Remote Access

Definition of Done:

- Cài lên server một lần
- Chạy ổn định nhiều tháng
- Không cần thao tác thủ công thường xuyên

## Phase 6 - Metadata Experience

Status: **IN PROGRESS** (khoảng 30%)

Mục tiêu: tiệm cận Roon.

Tính năng:

- Better Artist Biography
- Better Album Metadata
- Credits
- Composer
- Conductor
- Genre Hierarchy
- Artist Relationships

Ví dụ:

```text
Lệ Thu
|- Khánh Ly
|- Thanh Thúy
`- Vietnamese Folk
```

Definition of Done:

- Artist pages giàu thông tin
- Album pages giàu thông tin
- Metadata có giá trị thực sự

## Phase 7 - Roon-like Polish

Status: **OPTIONAL**

Chỉ thực hiện sau khi các phase cốt lõi hoàn tất.

Tính năng:

- Signal Path
- Advanced Discovery
- Music Graph
- Collection Insights
- Listening Analytics nâng cao

## MVP Completion Criteria

Music Server được xem là hoàn thành MVP lớn khi:

- Library lớn chạy mượt
- Queue ổn định
- Playlist ổn định
- Artist Detail tốt
- Album Detail tốt
- Similar Artists hoạt động
- Artist Radio hoạt động
- Mobile UX hoàn chỉnh
- Multi-user hoàn chỉnh
- Remote access hoàn chỉnh
- Scheduled scan hoàn chỉnh

## Tiến độ tổng thể

| Phase | Tiến độ |
|---|---:|
| Phase 1 - Foundation | 100% |
| Phase 2 - Core Music Experience | ~80% |
| Phase 3 - Playback Experience | 0% |
| Phase 4 - Multi-user | 0% |
| Phase 5 - Self-hosted Experience | ~20% |
| Phase 6 - Metadata Experience | ~30% |
| Tổng thể dự án | 70-75% |

## MVP còn lại

1. Hoàn tất v3.2 Discovery Engine
2. Playback Experience
3. Multi-user
4. Self-hosted Experience

Sau bốn block này, Music Server đạt mục tiêu "Navidrome + Plex Music cho cá nhân sử dụng hằng ngày".
Những tính năng sau đó thuộc nhóm Roon-like enhancements, không còn là core requirements.
