package com.zedral.m1operator.ui.orders

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.zedral.m1operator.ui.components.AdaptiveThreeColumnLayout
import com.zedral.m1operator.ui.components.ResponsiveCard
import com.zedral.m1operator.ui.theme.ZedralMuted

@Composable
fun OrdersScreen(windowSizeClass: androidx.compose.material3.windowsizeclass.WindowSizeClass) {
    Surface(color = MaterialTheme.colorScheme.background) {
        AdaptiveThreeColumnLayout(
            windowSizeClass = windowSizeClass,
            modifier = Modifier.padding(16.dp),
            leftContent = {
                OrderListPanel()
            },
            centerContent = {
                OrderDetailPanel()
            },
            rightContent = {
                ActionRailPanel()
            }
        )
    }
}

@Composable
fun OrderListPanel() {
    Column(modifier = Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = "",
            onValueChange = {},
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search orders...") },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            shape = MaterialTheme.shapes.medium
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        Text("QUEUE", style = MaterialTheme.typography.labelMedium, color = ZedralMuted)
        
        Spacer(modifier = Modifier.height(8.dp))
        
        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.weight(1f)
        ) {
            items((1..20).toList()) { i ->
                ResponsiveCard {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("BATCH #300$i", style = MaterialTheme.typography.titleMedium)
                        Text("Hero Steels Ltd", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
fun OrderDetailPanel() {
    Column(modifier = Modifier.fillMaxSize()) {
        ResponsiveCard(modifier = Modifier.weight(1f)) {
            Column(modifier = Modifier.padding(24.dp)) {
                Text("ORDER DETAILS", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text("COIL-2024-X450", style = MaterialTheme.typography.displaySmall)
                
                Divider(modifier = Modifier.padding(vertical = 16.dp))
                
                // Content...
                LazyColumn(modifier = Modifier.weight(1f)) {
                    item {
                        Text("Detailed specifications and status go here. This section expands to fill the available space while maintaining the overall screen structure.",
                            style = MaterialTheme.typography.bodyLarge)
                    }
                }
                
                Spacer(modifier = Modifier.height(16.dp))
                
                Button(
                    onClick = {},
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = MaterialTheme.shapes.medium
                ) {
                    Text("START PRODUCTION")
                }
            }
        }
    }
}

@Composable
fun ActionRailPanel() {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        val actions = listOf("END", "STOPPAGE", "REMARK", "REJECT")
        actions.forEach { action ->
            Button(
                onClick = {},
                modifier = Modifier.fillMaxWidth().aspectRatio(1f),
                shape = MaterialTheme.shapes.large,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (action == "STOPPAGE") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,
                    contentColor = if (action == "STOPPAGE") MaterialTheme.colorScheme.onError else MaterialTheme.colorScheme.onSecondary
                )
            ) {
                Text(action, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}
