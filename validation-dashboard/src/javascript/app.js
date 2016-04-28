Ext.define("TSValidationApp", {
extend: 'CA.techservices.app.ChartApp',
    
    description: '<strong>Data Validation</strong>' +
                '<p/>' + 
                'The stacked bar chart shows a count of items that fail the various validation rules.  Each bar ' +
                'represents a team.  For a story to be evaluated, it needs to be either In-Progress or Completed or ' +
                'Defined (when also Ready).  For a task to be evaluated, its story needs to meet the same state rule.' +
                '<p/>' + 
                '<strong>Rules</strong>' +
                '<p/>',
    
    integrationHeaders : {
        name : "TSValidationApp"
    },

    rules: [ 
        {xtype:'tsstoryrequiredfieldrule', requiredFields: ['Release','Owner','Description','Feature',
            'c_AcceptanceCriteria','c_Type','c_IsTestable']},
        {xtype:'tstaskrequiredfieldrule',  requiredFields: ['Owner']},
        {xtype:'tstasktodonoestimate'},
        {xtype:'tstaskactivenotodo'},
        {xtype:'tsstorycompletednoactuals'},
        {xtype:'tstaskcompletednoactuals'},
        {xtype:'tsstorywithoutepmsid'}
    ],
    
    launch: function() {
        this.callParent();
        var me = this;
        
        this._addSelectors();
        
        var story_base_filter = Rally.data.wsapi.Filter.or([
            {property:'ScheduleState', value:'Completed' },
            {property:'ScheduleState', value:'In-Progress'}
        ]);
        
        var story_ready_filter = Rally.data.wsapi.Filter.and([
            {property:'ScheduleState', value: 'Defined' },
            {property:'Ready', value: true }
        ]);
        
        var task_base_filter = Rally.data.wsapi.Filter.or([
            {property:'WorkProduct.ScheduleState', value:'Completed' },
            {property:'WorkProduct.ScheduleState', value:'In-Progress'}
        ]);
        
        var task_ready_filter = Rally.data.wsapi.Filter.and([
            {property:'WorkProduct.ScheduleState', value: 'Defined' },
            {property:'WorkProduct.Ready', value: true }
        ]);
        
        var validator = Ext.create('CA.techservices.validator.Validator',{
            rules: this.rules,
            fetchFields: ['FormattedID','ObjectID'],
            baseFilters: {
                HierarchicalRequirement: story_base_filter.or(story_ready_filter),
                Task: task_base_filter.or(task_ready_filter)
            },
            pointEvents: {
                click: function() {
                    me.showDrillDown(this._records,this._name);
                }
            }
        });
        
        this.description = this.description + validator.getRuleDescriptions();
        

        this.setDescription();
        
        this.setLoading("Loading data...");
        
        Deft.Chain.pipeline([
            function() { 
                me.setLoading("Gathering data...");
                return validator.gatherData(); 
            },
            function() { 
                me.setLoading("Analyzing data...");
                return validator.getChartData(); 
            }
        ]).then({
            scope: this,
            success: function(results) {
                
                if ( results.categories && results.categories.length === 0 ) {
                    Ext.Msg.alert('','No violations found');
                    return;
                }
                
                this.display_rows = Ext.Object.getValues( validator.recordsByModel );
                
                this._makeChart(results);
                this.down('#export_button').setDisabled(false);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem loading data', msg);
            }
        }).always(function() { me.setLoading(false); });
        
    }, 
    
    _addSelectors: function() {
        var container = this.down('#banner_box');
        container.removeAll();
        
        container.add({xtype:'container',flex: 1});
        
        container.add({
            xtype:'rallybutton',
            itemId:'export_button',
            cls: 'secondary',
            text: '<span class="icon-export"> </span>',
            disabled: true,
            listeners: {
                scope: this,
                click: function() {
                    this._export();
                }
            }
        });
    },
    
    _makeChart: function(data) {
        var me = this;
        
        this.logger.log('_makeChart', data);
        var colors = CA.apps.charts.Colors.getConsistentBarColors();
        
        if ( this.getSetting('showPatterns') ) {
            colors = CA.apps.charts.Colors.getConsistentBarPatterns();
        }
        
        this.setChart({
            chartData: data,
            chartConfig: this._getChartConfig(),
            chartColors: colors
        });
    },
    
    _getChartConfig: function() {
        var me = this;
        return {
            chart: { type:'column' },
            title: { text: 'Validation Results' },
            xAxis: {},
            yAxis: { 
                min: 0,
                title: { text: 'Count' }
            },
            plotOptions: {
                column: {
                    stacking: 'normal'
                }
            }
        }
    },
    
    showDrillDown: function(records, title) {
        var me = this;

        var store = Ext.create('Rally.data.custom.Store', {
            data: records,
            pageSize: 2000
        });
        
        Ext.create('Rally.ui.dialog.Dialog', {
            id        : 'detailPopup',
            title     : title,
            width     : 500,
            height    : 400,
            closable  : true,
            layout    : 'border',
            items     : [
            {
                xtype                : 'rallygrid',
                region               : 'center',
                layout               : 'fit',
                sortableColumns      : true,
                showRowActionsColumn : false,
                showPagingToolbar    : false,
                columnCfgs           : [
                    {
                        dataIndex : 'FormattedID',
                        text: "id"
                    },
                    {
                        dataIndex : 'Name',
                        text: "Name",
                        flex: 1
                    },
                    {
                        dataIndex: '__ruleText',
                        text: 'Violations',
                        flex: 2,
                        renderer: function(value, meta, record) {
                            if ( Ext.isEmpty(value) ) { return ""; }
                            var display_value = "";
                            Ext.Array.each(value, function(violation){
                                display_value = display_value + Ext.String.format("<li>{0}</li>", violation);
                            });

                            return Ext.String.format("<ul>{0}</ul>", display_value);
                        }
                    }
                ],
                store : store
            }]
        }).show();
    },
    
    _export: function(){
        var me = this;
        this.logger.log('_export');
        
        var grid = this.down('rallygrid');
        var rows = Ext.Array.flatten( this.display_rows );
        
        rows = Ext.Array.map(rows, function(row) { return row.data; });
        
        this.logger.log('number of rows:', rows.length);
        
        if (!rows ) { return; }
        
        var store = Ext.create('Rally.data.custom.Store',{ data: rows });
        
        if ( !grid ) {
            grid = Ext.create('Rally.ui.grid.Grid',{
                store: store,
                columnCfgs: [{
                    dataIndex: 'FormattedID',
                    text: 'ID'
                },
                {
                    dataIndex: 'Name',
                    text: 'Name'
                },
                {
                    dataIndex: 'Project',
                    text: 'Project',
                    renderer: function(value,meta,record){
                        if ( Ext.isEmpty(value) ) { 
                            return "";
                        }
                        return value._refObjectName
                    }
                },
                {
                    dataIndex: '__ruleText',
                    text:'Rules',
                    renderer: function(value,meta,record){                        
                        return value.join('\r\n');
                    }
                }
                
                ]
            });
        }
        
        var filename = 'timesheet-report.csv';

        this.logger.log('saving file:', filename);
        
        this.setLoading("Generating CSV");
        Deft.Chain.sequence([
            function() { return Rally.technicalservices.FileUtilities.getCSVFromRows(this,grid,rows); } 
        ]).then({
            scope: this,
            success: function(csv){
                this.logger.log('got back csv ', csv.length);
                if (csv && csv.length > 0){
                    Rally.technicalservices.FileUtilities.saveCSVToFile(csv,filename);
                } else {
                    Rally.ui.notify.Notifier.showWarning({message: 'No data to export'});
                }
                
            }
        }).always(function() { me.setLoading(false); });
    }
});
