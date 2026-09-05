import Foundation

nonisolated enum AppleMusicLyricsLinePositionPlanner {
    nonisolated struct PlannedLine<ID: Hashable>: Hashable {
        let id: ID
        let order: Int
        let delay: TimeInterval
    }

    static func plan<ID: Hashable>(
        mountedIDsInLyricOrder: [ID],
        currentViewportIDs: Set<ID>,
        targetViewportIDs: Set<ID>,
        animationOriginID: ID? = nil,
        contentOffsetDelta: Double,
        profile: AppleMusicLyricsMotionProfile = .macOS26_6
    ) -> [PlannedLine<ID>] {
        let viewportUnion = currentViewportIDs.union(targetViewportIDs)
        guard let firstIndex = mountedIDsInLyricOrder.firstIndex(
            where: viewportUnion.contains
        ), let lastIndex = mountedIDsInLyricOrder.lastIndex(
            where: viewportUnion.contains
        ), firstIndex <= lastIndex else { return [] }

        let participatingIDs = mountedIDsInLyricOrder[firstIndex...lastIndex]
        let delta = abs(contentOffsetDelta) < 1 ? 0 : contentOffsetDelta
        let isReverse = delta < 0
        let delayStep = isReverse
            ? profile.reverseCascadeDelay
            : profile.forwardCascadeDelay

        if let animationOriginID,
           let originIndex = mountedIDsInLyricOrder.firstIndex(
               of: animationOriginID
           ), (firstIndex...lastIndex).contains(originIndex) {
            return participatingIDs.enumerated().map { offset, id in
                let index = firstIndex + offset
                let order = isReverse
                    ? max(originIndex - index, 0)
                    : max(index - originIndex, 0)
                return PlannedLine(
                    id: id,
                    order: order,
                    delay: TimeInterval(max(order - 1, 0)) * delayStep
                )
            }
        }

        let lastOrder = participatingIDs.count - 1

        return participatingIDs.enumerated().map { index, id in
            let order = isReverse ? lastOrder - index : index
            return PlannedLine(
                id: id,
                order: order,
                delay: TimeInterval(max(order - 1, 0)) * delayStep
            )
        }
    }
}

