package com.zedral.m1operator.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun AdaptiveThreeColumnLayout(
    windowSizeClass: WindowSizeClass,
    leftContent: @Composable ColumnScope.() -> Unit,
    centerContent: @Composable ColumnScope.() -> Unit,
    rightContent: @Composable ColumnScope.() -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxSize(),
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Left Panel (Weight 0.40 on expanded)
        Column(
            modifier = Modifier
                .weight(0.40f)
                .fillMaxHeight(),
            content = leftContent
        )

        // Center Panel (Weight 0.45 on expanded)
        Column(
            modifier = Modifier
                .weight(0.45f)
                .fillMaxHeight(),
            content = centerContent
        )

        // Right Panel (Weight 0.15 on expanded)
        Column(
            modifier = Modifier
                .weight(0.15f)
                .fillMaxHeight(),
            content = rightContent
        )
    }
}

@Composable
fun ResponsiveCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit
) {
    androidx.compose.material3.ElevatedCard(
        modifier = modifier.fillMaxWidth(),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
        colors = androidx.compose.material3.CardDefaults.elevatedCardColors(
            containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surface
        ),
        elevation = androidx.compose.material3.CardDefaults.elevatedCardElevation(defaultElevation = 2.dp),
        content = content
    )
}
