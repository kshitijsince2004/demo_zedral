package com.zedral.m1operator.ui.production

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zedral.m1operator.ui.components.ResponsiveCard
import com.zedral.m1operator.ui.theme.Success
import com.zedral.m1operator.ui.theme.ZedralGreen

@Composable
fun ProductionConsoleScreen() {
    var inputThickness by remember { mutableStateOf("2.5") }
    var targetWidth by remember { mutableStateOf("1250") }
    var materialGrade by remember { mutableStateOf("JSW-300") }
    var showStoppageDialog by remember { mutableStateOf(false) }

    if (showStoppageDialog) {
        AlertDialog(
            onDismissRequest = { showStoppageDialog = false },
            title = { Text("Report Stoppage") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Select reason for stoppage:")
                    OutlinedButton(onClick = { showStoppageDialog = false }, modifier = Modifier.fillMaxWidth()) {
                        Text("Mechanical Failure")
                    }
                    OutlinedButton(onClick = { showStoppageDialog = false }, modifier = Modifier.fillMaxWidth()) {
                        Text("Electrical Issue")
                    }
                    OutlinedButton(onClick = { showStoppageDialog = false }, modifier = Modifier.fillMaxWidth()) {
                        Text("Material Shortage")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showStoppageDialog = false }) { Text("CANCEL") }
            }
        )
    }

    Scaffold(
        topBar = { ProductionTopTimer() },
        bottomBar = {
            ProductionBottomActions(
                onStartClick = { /* Handle Start */ },
                onStoppageClick = { showStoppageDialog = true }
            )
        }
    ) { padding ->
        val mainScrollState = rememberScrollState()
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .verticalScroll(mainScrollState)
        ) {
            // Fixed Current Order Card
            CurrentOrderCard()

            Spacer(modifier = Modifier.height(8.dp))

            // Scrollable Sections
            Row(modifier = Modifier.height(500.dp)) {
                // Production Data (Scrollable)
                LazyColumn(
                    modifier = Modifier
                        .weight(0.6f)
                        .fillMaxHeight(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item { SectionHeader("Production Details") }
                    item {
                        DetailInputRow("Input Thickness (mm)", inputThickness) { inputThickness = it }
                    }
                    item {
                        DetailInputRow("Target Width (mm)", targetWidth) { targetWidth = it }
                    }
                    item {
                        DetailInputRow("Material Grade", materialGrade) { materialGrade = it }
                    }
                    
                    item { Spacer(modifier = Modifier.height(12.dp)) }
                    
                    item { SectionHeader("Process Parameters") }
                    items((1..5).toList()) { i ->
                        ResponsiveCard {
                            Text("Parameter Group $i", modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                Spacer(modifier = Modifier.width(16.dp))

                // Pass List (Scrollable independently)
                LazyColumn(
                    modifier = Modifier
                        .weight(0.4f)
                        .fillMaxHeight(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    item { SectionHeader("Passes") }
                    items((1..15).toList()) { pass ->
                        PassItem(pass)
                    }
                }
            }
        }
    }
}

@Composable
fun ProductionTopTimer() {
    Surface(
        color = ZedralGreen,
        contentColor = Color.White
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("ZEDRAL M1", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Black)
                Text("PLANT 1100 · COLD ROLLING", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.7f))
            }
            Text("00:45:12", style = MaterialTheme.typography.headlineLarge, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
            StatusBadge("Running", Success)
        }
    }
}

@Composable
fun CurrentOrderCard() {
    ResponsiveCard {
        Row(
            modifier = Modifier
                .padding(16.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("Current Order", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                Text("COIL-2024-X450", style = MaterialTheme.typography.titleLarge)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("Customer", style = MaterialTheme.typography.labelSmall)
                Text("Hero Steels Ltd", style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}

@Composable
fun SectionHeader(title: String) {
    Text(
        text = title.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(bottom = 8.dp),
        letterSpacing = 1.5.sp
    )
}

@Composable
fun DetailInputRow(label: String, value: String, onValueChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        textStyle = MaterialTheme.typography.bodyMedium,
        singleLine = true
    )
}

@Composable
fun PassItem(number: Int) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = if (number == 3) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
        shape = MaterialTheme.shapes.small
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("P$number", fontWeight = FontWeight.Bold, modifier = Modifier.width(32.dp))
            Text("Thickness: 1.25mm", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun StatusBadge(text: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.2f),
        contentColor = color,
        shape = MaterialTheme.shapes.extraSmall
    ) {
        Text(
            text = text.uppercase(),
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun ProductionBottomActions(onStartClick: () -> Unit, onStoppageClick: () -> Unit) {
    Surface(tonalElevation = 2.dp) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Button(
                onClick = onStartClick,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Success),
                shape = MaterialTheme.shapes.medium
            ) {
                Icon(Icons.Default.PlayArrow, null)
                Spacer(Modifier.width(8.dp))
                Text("START", fontWeight = FontWeight.Bold)
            }
            Button(
                onClick = onStoppageClick,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                shape = MaterialTheme.shapes.medium
            ) {
                Icon(Icons.Default.Warning, null)
                Spacer(Modifier.width(8.dp))
                Text("STOPPAGE", fontWeight = FontWeight.Bold)
            }
        }
    }
}
